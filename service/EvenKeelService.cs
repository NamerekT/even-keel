using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text;
using System.Threading;

public sealed class EvenKeelService : ServiceBase
{
    const long RotateBytes = 5 * 1024 * 1024;
    static readonly TimeSpan HealthyRun = TimeSpan.FromMinutes(5);
    static readonly int[] BackoffSeconds = { 5, 15, 60 };
    static readonly Encoding Utf8 = new UTF8Encoding(false);

    readonly string root;
    readonly string node;
    // The data folder of an npm install, passed on as EVEN_KEEL_DATA; null for a checkout, which keeps its data.
    readonly string data;
    // The tray host's own exe, passed on as EVEN_KEEL_LAUNCHER: node finds there how to stop and start itself for an update.
    readonly string launcher;
    readonly string who;
    readonly string logFile;
    readonly object logGate = new object();
    readonly object childGate = new object();
    readonly ManualResetEvent stopRequested = new ManualResetEvent(false);
    // Reset while the tray host holds node stopped (EvenKeel.exe --stop, for an update).
    readonly ManualResetEvent runAllowed = new ManualResetEvent(true);
    readonly ManualResetEvent nodeDown = new ManualResetEvent(true);
    int restartRequested;
    Thread supervisor;
    Process child;
    DateTime nodeStartedAt;

    EvenKeelService(string root, string node, string data, string launcher)
    {
        this.root = root;
        this.node = node;
        this.data = data;
        this.launcher = launcher;
        who = launcher == null ? "service" : "tray";
        logFile = Path.Combine(data ?? root, "logs", "even-keel.log");
        ServiceName = "EvenKeel";
        CanShutdown = true;
    }

    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--stop") return EvenKeelHost.Stop();
        if (args.Length == 1 && args[0] == "--quit") return EvenKeelHost.Quit();
        string mode = args.Length > 0 && args[args.Length - 1].StartsWith("--") ? args[args.Length - 1] : null;
        int count = mode == null ? args.Length : args.Length - 1;
        if ((count != 2 && count != 3) || (mode != null && mode != "--console" && mode != "--tray" && mode != "--start"))
        {
            Console.Error.WriteLine("usage: EvenKeelService.exe <even-keel-root> <node.exe> [<data folder>] [--console]");
            Console.Error.WriteLine("       EvenKeel.exe <even-keel-root> <node.exe> [<data folder>] --tray|--start");
            Console.Error.WriteLine("       EvenKeel.exe --stop|--quit");
            return 2;
        }
        if (mode == "--start") return EvenKeelHost.Start(args);
        string launcher = mode == "--tray" ? Process.GetCurrentProcess().MainModule.FileName : null;
        var service = new EvenKeelService(Path.GetFullPath(args[0]), args[1], count == 3 ? Path.GetFullPath(args[2]) : null, launcher);
        if (mode == null)
        {
            Run(service);
            return 0;
        }
        if (mode == "--tray") return EvenKeelTray.Run(service);
        service.OnStart(args);
        Console.WriteLine("running in the foreground, press Enter to stop; log: " + service.logFile);
        Console.ReadLine();
        service.OnStop();
        return 0;
    }

    internal string Root { get { return root; } }
    internal string Data { get { return data; } }

    // Whether node is held stopped; while it is not, when it was started last.
    internal bool Paused { get { return !runAllowed.WaitOne(0); } }
    internal DateTime NodeStartedAt { get { return nodeStartedAt; } }

    internal void Begin()
    {
        OnStart(null);
    }

    internal void End()
    {
        Shutdown();
    }

    // Stops node and keeps it stopped until Resume; false — it was still running after the wait.
    internal bool Pause(TimeSpan wait)
    {
        lock (childGate)
        {
            runAllowed.Reset();
            KillChild();
        }
        bool down = nodeDown.WaitOne(wait);
        Log(who + (down ? ": node stopped, waiting for a start" : ": node did not stop"));
        return down;
    }

    internal void Resume()
    {
        runAllowed.Set();
    }

    // Starts node again at once: no backoff, and a restart is no failure.
    internal void Restart()
    {
        if (Paused)
        {
            Resume();
            return;
        }
        Interlocked.Exchange(ref restartRequested, 1);
        lock (childGate) KillChild();
    }

    protected override void OnStart(string[] args)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(logFile));
        Log(string.Format("{0}: start as {1}\\{2}, session {3}, profile {4}", who,
            Environment.UserDomainName, Environment.UserName,
            Process.GetCurrentProcess().SessionId, Environment.GetEnvironmentVariable("USERPROFILE")));
        supervisor = new Thread(Supervise) { IsBackground = true, Name = "even-keel-supervisor" };
        supervisor.Start();
    }

    protected override void OnStop()
    {
        Shutdown();
    }

    protected override void OnShutdown()
    {
        Shutdown();
    }

    void Shutdown()
    {
        if (stopRequested.WaitOne(0)) return;
        stopRequested.Set();
        lock (childGate) KillChild();
        if (supervisor != null) supervisor.Join(TimeSpan.FromSeconds(15));
        Log(who + ": stopped");
    }

    void KillChild()
    {
        Process running = child;
        if (running == null) return;
        try
        {
            if (!running.HasExited) running.Kill();
        }
        catch (InvalidOperationException)
        {
        }
        catch (System.ComponentModel.Win32Exception)
        {
        }
    }

    void Supervise()
    {
        int failures = 0;
        var gates = new WaitHandle[] { stopRequested, runAllowed };
        while (WaitHandle.WaitAny(gates) == 1)
        {
            DateTime startedAt = DateTime.UtcNow;
            int? exitCode = RunNode();
            if (stopRequested.WaitOne(0)) return;
            if (exitCode == null) continue;
            if (Interlocked.Exchange(ref restartRequested, 0) == 1)
            {
                failures = 0;
                Log(who + ": restarting node");
                continue;
            }
            if (Paused)
            {
                failures = 0;
                continue;
            }

            failures = DateTime.UtcNow - startedAt >= HealthyRun ? 0 : failures + 1;
            int delay = BackoffSeconds[Math.Min(Math.Max(failures - 1, 0), BackoffSeconds.Length - 1)];
            Log(string.Format("{0}: node exited with code {1}, restarting in {2}s", who, exitCode, delay));
            stopRequested.WaitOne(TimeSpan.FromSeconds(delay));
        }
    }

    // null — node was held stopped before it started.
    int? RunNode()
    {
        // A checkout runs its sources; the npm package has only the compiled code.
        string script = File.Exists(Path.Combine(root, "src", "main.ts")) ? "--import tsx src/main.ts" : "dist/src/main.js";
        var info = new ProcessStartInfo(node, script)
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        if (data != null) info.EnvironmentVariables["EVEN_KEEL_DATA"] = data;
        if (launcher != null) info.EnvironmentVariables["EVEN_KEEL_LAUNCHER"] = launcher;
        try
        {
            using (var process = new Process { StartInfo = info })
            {
                process.OutputDataReceived += (sender, e) => { if (e.Data != null) Log(e.Data); };
                process.ErrorDataReceived += (sender, e) => { if (e.Data != null) Log(e.Data); };
                lock (childGate)
                {
                    if (Paused || stopRequested.WaitOne(0)) return null;
                    process.Start();
                    child = process;
                    nodeStartedAt = DateTime.UtcNow;
                    nodeDown.Reset();
                }
                Log(string.Format("{0}: node started, pid {1}", who, process.Id));
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                lock (childGate)
                {
                    child = null;
                    nodeDown.Set();
                }
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            lock (childGate)
            {
                child = null;
                nodeDown.Set();
            }
            Log(who + ": could not start node: " + error.Message);
            return -1;
        }
    }

    internal void Log(string line)
    {
        lock (logGate)
        {
            try
            {
                var file = new FileInfo(logFile);
                if (file.Exists && file.Length > RotateBytes)
                {
                    string previous = Path.Combine(file.DirectoryName, "even-keel.1.log");
                    File.Delete(previous);
                    file.MoveTo(previous);
                }
                File.AppendAllText(logFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + line + Environment.NewLine, Utf8);
            }
            catch (IOException)
            {
            }
        }
    }
}

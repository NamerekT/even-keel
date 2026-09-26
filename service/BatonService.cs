using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text;
using System.Threading;

public sealed class BatonService : ServiceBase
{
    const long RotateBytes = 5 * 1024 * 1024;
    static readonly TimeSpan HealthyRun = TimeSpan.FromMinutes(5);
    static readonly int[] BackoffSeconds = { 5, 15, 60 };
    static readonly Encoding Utf8 = new UTF8Encoding(false);

    readonly string root;
    readonly string node;
    readonly string logFile;
    readonly object logGate = new object();
    readonly ManualResetEvent stopRequested = new ManualResetEvent(false);
    Thread supervisor;
    Process child;

    BatonService(string root, string node)
    {
        this.root = root;
        this.node = node;
        logFile = Path.Combine(root, "logs", "baton.log");
        ServiceName = "Baton";
        CanShutdown = true;
    }

    public static int Main(string[] args)
    {
        bool console = args.Length == 3 && args[2] == "--console";
        if (args.Length != 2 && !console)
        {
            Console.Error.WriteLine("usage: BatonService.exe <baton-root> <node.exe> [--console]");
            return 2;
        }
        var service = new BatonService(Path.GetFullPath(args[0]), args[1]);
        if (!console)
        {
            Run(service);
            return 0;
        }
        service.OnStart(args);
        Console.WriteLine("running in the foreground, press Enter to stop; log: " + service.logFile);
        Console.ReadLine();
        service.OnStop();
        return 0;
    }

    protected override void OnStart(string[] args)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(logFile));
        Log(string.Format("service: start as {0}\\{1}, session {2}, profile {3}",
            Environment.UserDomainName, Environment.UserName,
            Process.GetCurrentProcess().SessionId, Environment.GetEnvironmentVariable("USERPROFILE")));
        supervisor = new Thread(Supervise) { IsBackground = true, Name = "baton-supervisor" };
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
        stopRequested.Set();
        Process running = child;
        if (running != null)
        {
            try
            {
                if (!running.HasExited) running.Kill();
            }
            catch (InvalidOperationException)
            {
            }
        }
        if (supervisor != null) supervisor.Join(TimeSpan.FromSeconds(15));
        Log("service: stopped");
    }

    void Supervise()
    {
        int failures = 0;
        while (!stopRequested.WaitOne(0))
        {
            DateTime startedAt = DateTime.UtcNow;
            int exitCode = RunNode();
            if (stopRequested.WaitOne(0)) return;

            failures = DateTime.UtcNow - startedAt >= HealthyRun ? 0 : failures + 1;
            int delay = BackoffSeconds[Math.Min(Math.Max(failures - 1, 0), BackoffSeconds.Length - 1)];
            Log(string.Format("service: node exited with code {0}, restarting in {1}s", exitCode, delay));
            stopRequested.WaitOne(TimeSpan.FromSeconds(delay));
        }
    }

    int RunNode()
    {
        var info = new ProcessStartInfo(node, "--import tsx src/main.ts")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        try
        {
            using (var process = new Process { StartInfo = info })
            {
                process.OutputDataReceived += (sender, e) => { if (e.Data != null) Log(e.Data); };
                process.ErrorDataReceived += (sender, e) => { if (e.Data != null) Log(e.Data); };
                process.Start();
                child = process;
                Log(string.Format("service: node started, pid {0}", process.Id));
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                child = null;
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            child = null;
            Log("service: could not start node: " + error.Message);
            return -1;
        }
    }

    void Log(string line)
    {
        lock (logGate)
        {
            try
            {
                var file = new FileInfo(logFile);
                if (file.Exists && file.Length > RotateBytes)
                {
                    string previous = Path.Combine(file.DirectoryName, "baton.1.log");
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

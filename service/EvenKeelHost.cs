using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;

// The commands between the tray host and whoever drives it: `even-keel` in a terminal, the update process the page
// starts, `rebuild.ps1` over SSH. The names are global, so a process in another Windows session of the same user (SSH)
// reaches the host on the desktop. A stop holds node stopped inside the host, which stays: a host started from SSH
// would have no tray and die with the SSH session.
static class EvenKeelHost
{
    const string Prefix = "Global\\EvenKeel.";
    static readonly TimeSpan Wait = TimeSpan.FromSeconds(30);

    static EventWaitHandle Event(string name, EventResetMode mode)
    {
        bool created;
        return new EventWaitHandle(false, mode, Prefix + name, out created);
    }

    static bool Running(out Mutex host)
    {
        return Mutex.TryOpenExisting(Prefix + "Host", out host);
    }

    // The one host of the machine; null — another one has it.
    internal static Mutex Claim()
    {
        bool created;
        var host = new Mutex(true, Prefix + "Host", out created);
        if (created) return host;
        host.Dispose();
        return null;
    }

    // Runs the commands of the other processes until a quit, which calls `quit`.
    internal static void Serve(EvenKeelService service, Action quit)
    {
        var handles = new WaitHandle[] { Event("Quit", EventResetMode.AutoReset), Event("Stop", EventResetMode.AutoReset), Event("Start", EventResetMode.AutoReset) };
        var stopped = Event("Stopped", EventResetMode.ManualReset);
        stopped.Reset();
        new Thread(() =>
        {
            while (true)
            {
                switch (WaitHandle.WaitAny(handles))
                {
                    case 0:
                        service.Log("tray: quit asked");
                        quit();
                        return;
                    case 1:
                        service.Log("tray: stop asked");
                        if (service.Pause(Wait)) stopped.Set();
                        break;
                    case 2:
                        service.Log("tray: start asked");
                        stopped.Reset();
                        service.Resume();
                        break;
                }
            }
        }) { IsBackground = true, Name = "even-keel-commands" }.Start();
    }

    // `--stop`: node stopped, the host waits for a start; no host is nothing to stop.
    internal static int Stop()
    {
        Mutex host;
        if (!Running(out host)) return 0;
        using (host)
        using (var stop = Event("Stop", EventResetMode.AutoReset))
        using (var stopped = Event("Stopped", EventResetMode.ManualReset))
        {
            stop.Set();
            if (stopped.WaitOne(Wait)) return 0;
            Console.Error.WriteLine("EvenKeel.exe: the host did not stop node in 30 s");
            return 1;
        }
    }

    // `--start`: node of a running host starts again; with no host, one starts with the same arguments and `--tray`.
    internal static int Start(string[] args)
    {
        Mutex host;
        if (Running(out host))
        {
            using (host)
            using (var start = Event("Start", EventResetMode.AutoReset))
            {
                start.Set();
            }
            return 0;
        }
        string exe = Process.GetCurrentProcess().MainModule.FileName;
        string line = string.Join(" ", args.Take(args.Length - 1).Concat(new[] { "--tray" }).Select(Quote));
        // A shell start inherits no handles: a caller waiting on this one's output does not wait for the host too.
        Process.Start(new ProcessStartInfo(exe, line) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) });
        return 0;
    }

    // `--quit`: the host stops node and exits.
    internal static int Quit()
    {
        Mutex host;
        if (!Running(out host)) return 0;
        using (host)
        using (var quit = Event("Quit", EventResetMode.AutoReset))
        {
            quit.Set();
            try
            {
                if (!host.WaitOne(Wait))
                {
                    Console.Error.WriteLine("EvenKeel.exe: the host did not quit in 30 s");
                    return 1;
                }
            }
            catch (AbandonedMutexException)
            {
                return 0;
            }
            host.ReleaseMutex();
            return 0;
        }
    }

    static string Quote(string arg)
    {
        return "\"" + (arg.EndsWith("\\") ? arg + "\\" : arg) + "\"";
    }
}

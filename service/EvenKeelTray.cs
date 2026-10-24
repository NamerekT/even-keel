using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// The autostart at sign-in (BTN-372): the host with an icon in the tray instead of a Windows service. The icon shows
// what GET /api/state says, read on loopback as the update's answer step reads it.
sealed class EvenKeelTray : ApplicationContext
{
    enum Status { Starting, Running, Paused, Asking, Stopped, Down }

    static readonly TimeSpan StartGrace = TimeSpan.FromMinutes(2);
    const int PollMs = 10000;

    readonly EvenKeelService service;
    readonly NotifyIcon icon;
    readonly ContextMenuStrip menu;
    readonly ToolStripMenuItem open;
    readonly ToolStripMenuItem restart;
    readonly ToolStripMenuItem quit;
    readonly System.Windows.Forms.Timer timer;
    readonly WebClient client = new WebClient { Encoding = Encoding.UTF8 };
    readonly Dictionary<Status, Icon> icons = new Dictionary<Status, Icon>();
    bool russian = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru";
    bool ending;

    EvenKeelTray(EvenKeelService service)
    {
        this.service = service;
        open = new ToolStripMenuItem("", null, (sender, e) => OpenPage()) { Font = new Font(SystemFonts.MenuFont, FontStyle.Bold) };
        restart = new ToolStripMenuItem("", null, (sender, e) => service.Restart());
        quit = new ToolStripMenuItem("", null, (sender, e) => End());
        menu = new ContextMenuStrip();
        menu.Items.AddRange(new ToolStripItem[] { open, new ToolStripSeparator(), restart, quit });
        // Created now, so the command thread can post the quit to this thread.
        IntPtr handle = menu.Handle;
        icon = new NotifyIcon { ContextMenuStrip = menu };
        icon.DoubleClick += (sender, e) => OpenPage();
        client.DownloadStringCompleted += (sender, e) => Show(e.Cancelled || e.Error != null ? null : e.Result);
        timer = new System.Windows.Forms.Timer { Interval = PollMs };
        timer.Tick += (sender, e) => Poll();
        Name();
        Show(Status.Starting, 0);
        icon.Visible = true;
    }

    internal static int Run(EvenKeelService service)
    {
        Mutex host = EvenKeelHost.Claim();
        if (host == null) return 0;
        Environment.CurrentDirectory = AppDomain.CurrentDomain.BaseDirectory;
        Application.EnableVisualStyles();
        var tray = new EvenKeelTray(service);
        service.Begin();
        EvenKeelHost.Serve(service, () => tray.menu.BeginInvoke(new Action(tray.End)));
        Microsoft.Win32.SystemEvents.SessionEnded += (sender, e) => service.End();
        tray.timer.Start();
        Application.Run(tray);
        host.ReleaseMutex();
        return 0;
    }

    void End()
    {
        if (ending) return;
        ending = true;
        timer.Stop();
        icon.Visible = false;
        service.End();
        ExitThread();
    }

    void Poll()
    {
        if (client.IsBusy)
        {
            client.CancelAsync();
            return;
        }
        client.DownloadStringAsync(new Uri(Base() + "api/state"));
    }

    void Show(string json)
    {
        if (ending) return;
        if (service.Paused)
        {
            Show(Status.Stopped, 0);
            return;
        }
        if (json == null)
        {
            Show(DateTime.UtcNow - service.NodeStartedAt < StartGrace ? Status.Starting : Status.Down, 0);
            return;
        }
        try
        {
            var state = (Dictionary<string, object>)new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 1000 }.DeserializeObject(json);
            object language;
            if (state.TryGetValue("language", out language) && language is string) russian = (string)language == "ru";
            Name();
            int asking = Items(state, "sessions").Count(session => Flag(session, "asking"));
            object chain;
            state.TryGetValue("chain", out chain);
            int paused = chain is Dictionary<string, object> ? Items((Dictionary<string, object>)chain, "active").Count(active => Flag(active, "paused")) : 0;
            Show(asking > 0 ? Status.Asking : paused > 0 ? Status.Paused : Status.Running, asking > 0 ? asking : paused);
        }
        catch (Exception)
        {
            Show(Status.Down, 0);
        }
    }

    static IEnumerable<object> Items(Dictionary<string, object> map, string key)
    {
        object items;
        return map.TryGetValue(key, out items) && items is object[] ? (object[])items : new object[0];
    }

    static bool Flag(object item, string key)
    {
        var map = item as Dictionary<string, object>;
        object value;
        return map != null && map.TryGetValue(key, out value) && value is bool && (bool)value;
    }

    void Show(Status status, int count)
    {
        Icon image;
        if (!icons.TryGetValue(status, out image)) icons[status] = image = Draw(status);
        icon.Icon = image;
        string text = "Even Keel: " + Text(status, count);
        icon.Text = text.Length > 63 ? text.Substring(0, 63) : text;
    }

    string Text(Status status, int count)
    {
        string many = count > 1 ? " (" + count + ")" : "";
        switch (status)
        {
            case Status.Running: return russian ? "работает" : "running";
            case Status.Paused: return (russian ? "цепочка на паузе" : "chain paused") + many;
            case Status.Asking: return (russian ? "ждёт ответа" : "waits for an answer") + many;
            case Status.Stopped: return russian ? "остановлен для обновления" : "stopped for an update";
            case Status.Down: return russian ? "не отвечает" : "not answering";
            default: return russian ? "запускается" : "starting";
        }
    }

    void Name()
    {
        open.Text = russian ? "Открыть страницу" : "Open the page";
        restart.Text = russian ? "Перезапустить" : "Restart";
        quit.Text = russian ? "Выйти" : "Quit";
    }

    // The page's icon with a dot of the status in its corner.
    Icon Draw(Status status)
    {
        Size size = SystemInformation.SmallIconSize;
        using (var bitmap = new Bitmap(size.Width, size.Height))
        {
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                string png = Path.Combine(service.Root, "dist", "web", "icon-192.png");
                if (File.Exists(png))
                {
                    using (var page = Image.FromFile(png)) graphics.DrawImage(page, 0, 0, size.Width, size.Height);
                }
                else
                {
                    using (var brush = new SolidBrush(Color.FromArgb(0x1f, 0x29, 0x37))) graphics.FillEllipse(brush, 0, 0, size.Width - 1, size.Height - 1);
                }
                int dot = size.Width / 2;
                var rect = new Rectangle(size.Width - dot - 1, size.Height - dot - 1, dot, dot);
                using (var brush = new SolidBrush(ColorOf(status))) graphics.FillEllipse(brush, rect);
                using (var pen = new Pen(Color.FromArgb(0x0d, 0x11, 0x17), Math.Max(1, size.Width / 16))) graphics.DrawEllipse(pen, rect);
            }
            return Icon.FromHandle(bitmap.GetHicon());
        }
    }

    static Color ColorOf(Status status)
    {
        switch (status)
        {
            case Status.Running: return Color.FromArgb(0x3f, 0xb9, 0x50);
            case Status.Paused: return Color.FromArgb(0xd2, 0x99, 0x22);
            case Status.Asking: return Color.FromArgb(0x58, 0xa6, 0xff);
            case Status.Down: return Color.FromArgb(0xf8, 0x51, 0x49);
            default: return Color.FromArgb(0x8b, 0x94, 0x9e);
        }
    }

    void OpenPage()
    {
        try
        {
            Process.Start(new ProcessStartInfo(Base()) { UseShellExecute = true });
        }
        catch (Exception error)
        {
            service.Log("tray: could not open the page: " + error.Message);
        }
    }

    // The page's address as the service reads it: the environment over `.env` of the data folder, as stateUrlOf reaches it.
    string Base()
    {
        var env = ReadEnv(Path.Combine(service.Data ?? service.Root, ".env"));
        string host = Environment.GetEnvironmentVariable("EVEN_KEEL_HOST") ?? Value(env, "EVEN_KEEL_HOST") ?? "127.0.0.1";
        string port = Environment.GetEnvironmentVariable("EVEN_KEEL_PORT") ?? Value(env, "EVEN_KEEL_PORT") ?? "4747";
        if (host == "" || host == "0.0.0.0" || host == "::") host = "127.0.0.1";
        else if (host.Contains(":")) host = "[" + host + "]";
        return "http://" + host + ":" + port + "/";
    }

    static string Value(Dictionary<string, string> env, string key)
    {
        string value;
        return env.TryGetValue(key, out value) && value != "" ? value : null;
    }

    static Dictionary<string, string> ReadEnv(string file)
    {
        var env = new Dictionary<string, string>();
        try
        {
            foreach (string raw in File.ReadAllLines(file))
            {
                string line = raw.Trim();
                int equals = line.IndexOf('=');
                if (line.StartsWith("#") || equals <= 0) continue;
                string value = line.Substring(equals + 1).Trim();
                if (value.Length >= 2 && (value[0] == '"' || value[0] == '\'') && value[value.Length - 1] == value[0]) value = value.Substring(1, value.Length - 2);
                env[line.Substring(0, equals).Trim()] = value;
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
        return env;
    }
}

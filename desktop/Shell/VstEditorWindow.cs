using System;
using System.Drawing;
using System.Windows.Forms;
using FreakyLoops.Shell.Audio;

namespace FreakyLoops.Shell;

// The plugin's editor GUI, shown as a borderless window OWNED by the app's main
// window: no taskbar entry, always above the app, positioned over it so it reads
// as an in-app panel. WebView2 composites above embedded child HWNDs, so a true
// in-window child won't paint — an owned overlay is the reliable way to show it.
internal sealed class VstEditorWindow : Form
{
    private const int HeaderH = 26;
    private const int EdgeT = 6;    // px border strip the form owns, for edge-resize
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WM_MOUSEACTIVATE = 0x0021;
    private const int MA_NOACTIVATE = 3;

    private const int WM_NCHITTEST = 0x0084;
    private const int HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13,
                      HTTOPRIGHT = 14, HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;

    private sealed class OwnerWindow : IWin32Window
    {
        public OwnerWindow(IntPtr h) { Handle = h; }
        public IntPtr Handle { get; }
    }

    private readonly VstHost _vst;
    private readonly System.Windows.Forms.Timer _idle;
    private readonly Panel _content;
    private Point _dragCursor;
    private Point _dragForm;
    private bool _dragging;

    public event Action? RequestClose;

    public VstEditorWindow(VstHost vst)
    {
        _vst = vst;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;     // plugin GUIs are pixel-exact
        BackColor = Color.FromArgb(18, 18, 24);
        // The Padding strip is form background that docked children don't cover, so
        // WM_NCHITTEST below can claim it for native edge-resize. Doubles as a frame.
        Padding = new Padding(EdgeT);
        MinimumSize = new Size(240, HeaderH + 2 * EdgeT + 80);

        Rectangle rect = _vst.GetEditorRect();
        int pw = Math.Max(220, rect.Width);
        int ph = Math.Max(100, rect.Height);

        var header = new Panel { Dock = DockStyle.Top, Height = HeaderH, BackColor = Color.FromArgb(28, 28, 38) };
        var title = new Label
        {
            Text = "  " + (vst.PluginName ?? "VST"),
            ForeColor = Color.Gainsboro, Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
        };
        var close = new Button
        {
            Text = "✕", Dock = DockStyle.Right, Width = 32,
            FlatStyle = FlatStyle.Flat, ForeColor = Color.Gainsboro, TabStop = false,
        };
        close.FlatAppearance.BorderSize = 0;
        close.Click += (_, _) => RequestClose?.Invoke();

        // Drag the panel by its header (screen-coordinate based).
        foreach (Control c in new Control[] { header, title })
        {
            c.MouseDown += (_, e) =>
            {
                if (e.Button != MouseButtons.Left) return;
                _dragging = true; _dragCursor = Control.MousePosition; _dragForm = Location;
            };
            c.MouseMove += (_, _) =>
            {
                if (!_dragging) return;
                Location = new Point(
                    _dragForm.X + Control.MousePosition.X - _dragCursor.X,
                    _dragForm.Y + Control.MousePosition.Y - _dragCursor.Y);
            };
            c.MouseUp += (_, _) => _dragging = false;
        }
        header.Controls.Add(title);
        header.Controls.Add(close);

        _content = new Panel { Dock = DockStyle.Fill, BackColor = Color.Black };
        Controls.Add(_content);
        Controls.Add(header);
        ClientSize = new Size(pw + 2 * EdgeT, ph + HeaderH + 2 * EdgeT);

        _idle = new System.Windows.Forms.Timer { Interval = 30 };
        _idle.Tick += (_, _) => { try { _vst.EditorIdle(); } catch { /* ignore */ } };
    }

    // Don't steal keyboard focus from the DAW: the editor shows and receives
    // mouse input (knobs/toggles) WITHOUT activating, so QWERTY keys and piano-roll
    // playback keep working while you tweak the plugin.
    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
            return cp;
        }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_MOUSEACTIVATE) { m.Result = (IntPtr)MA_NOACTIVATE; return; }

        // Claim the padding strip at the window edges for native resize, so the
        // borderless editor can be dragged larger/smaller by any edge or corner.
        if (m.Msg == WM_NCHITTEST)
        {
            int lp = (int)m.LParam;
            var screen = new Point(unchecked((short)(lp & 0xFFFF)), unchecked((short)((lp >> 16) & 0xFFFF)));
            Point p = PointToClient(screen);
            int w = ClientSize.Width, h = ClientSize.Height;
            bool l = p.X <= EdgeT, r = p.X >= w - EdgeT, t = p.Y <= EdgeT, b = p.Y >= h - EdgeT;
            int hit =
                t && l ? HTTOPLEFT : t && r ? HTTOPRIGHT : b && l ? HTBOTTOMLEFT : b && r ? HTBOTTOMRIGHT :
                l ? HTLEFT : r ? HTRIGHT : t ? HTTOP : b ? HTBOTTOM : 0;
            if (hit != 0) { m.Result = (IntPtr)hit; return; }
        }
        base.WndProc(ref m);
    }

    // Show owned by the app window, at the given screen position, then open the
    // plugin editor into the content area.
    public void ShowOver(IntPtr ownerHwnd, int screenX, int screenY)
    {
        Location = new Point(screenX, screenY);
        Show(new OwnerWindow(ownerHwnd));
        try
        {
            _vst.EditorOpen(_content.Handle);
            Rectangle r = _vst.GetEditorRect();
            Log.Write($"Editor shown: owner={ownerHwnd} at {screenX},{screenY} content={_content.Handle} rect={r.Width}x{r.Height}");
            if (r.Width > 0 && r.Height > 0)
                ClientSize = new Size(Math.Max(220, r.Width) + 2 * EdgeT,
                                      Math.Max(100, r.Height) + HeaderH + 2 * EdgeT);
            _idle.Start();
        }
        catch (Exception ex) { Log.Write("Editor open FAILED: " + ex); }
    }

    public void Teardown()
    {
        _idle.Stop();
        try { _vst.EditorClose(); } catch { /* ignore */ }
        try { Close(); Dispose(); } catch { /* ignore */ }
    }
}

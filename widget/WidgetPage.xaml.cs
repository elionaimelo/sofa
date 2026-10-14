using System;
using Microsoft.Gaming.XboxGameBar;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;
using Windows.UI.Xaml.Input;
using Windows.System;

namespace Sofa.Widget
{
    /// <summary>Hosts the HUD page served by Sofa (src-tauri/src/hud_server.rs); `widget=1` hides its own chrome.</summary>
    public sealed partial class WidgetPage : Page
    {
        // Fixed port, see hud_server::PORT.
        private static readonly Uri HudUrl = new Uri("http://127.0.0.1:47811/?hud=1&widget=1&nativeInput=1");
        private XboxGameBarWidget? widget;

        public WidgetPage()
        {
            InitializeComponent();
            // Own navigation before XAML tries to move focus out of WebView2.
            AddHandler(UIElement.PreviewKeyDownEvent, new KeyEventHandler(OnPreviewKeyDown), true);
            AddHandler(UIElement.PreviewKeyUpEvent, new KeyEventHandler(OnPreviewKeyUp), true);
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            widget = e.Parameter as XboxGameBarWidget;
            if (widget != null)
            {
                widget.RequestedThemeChanged += (_, _) => RequestedTheme = ElementTheme.Dark;
            }
            View.Source = HudUrl;
        }

        private void View_NavigationCompleted(WebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
        {
            // Connection refused means Sofa is closed; everything else (4xx) still renders the page.
            var offline = !args.IsSuccess && args.WebErrorStatus == CoreWebView2WebErrorStatus.ConnectionAborted
                || args.WebErrorStatus == CoreWebView2WebErrorStatus.CannotConnect;
            Offline.Visibility = offline ? Visibility.Visible : Visibility.Collapsed;
            View.Visibility = offline ? Visibility.Collapsed : Visibility.Visible;
            if (args.IsSuccess)
            {
                View.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
                View.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                View.Focus(FocusState.Programmatic);
            }
        }

        private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (args.Source != HudUrl.AbsoluteUri) return;
            if (args.WebMessageAsJson == "\"close\"") widget?.Close();
        }

        private static string? GamepadAction(VirtualKey key) => key switch
        {
            VirtualKey.GamepadDPadUp or VirtualKey.GamepadLeftThumbstickUp => "up",
            VirtualKey.GamepadDPadDown or VirtualKey.GamepadLeftThumbstickDown => "down",
            VirtualKey.GamepadDPadLeft or VirtualKey.GamepadLeftThumbstickLeft => "left",
            VirtualKey.GamepadDPadRight or VirtualKey.GamepadLeftThumbstickRight => "right",
            VirtualKey.GamepadA => "a",
            VirtualKey.GamepadB => "b",
            _ => null,
        };

        private void OnPreviewKeyUp(object sender, KeyRoutedEventArgs e)
        {
            // In particular, an unhandled B release would also invoke native back.
            if (GamepadAction(e.OriginalKey) != null && View.Source?.AbsoluteUri == HudUrl.AbsoluteUri
                && View.Visibility == Visibility.Visible && View.CoreWebView2 != null)
                e.Handled = true;
        }

        private async void OnPreviewKeyDown(object sender, KeyRoutedEventArgs e)
        {
            // Bumpers belong to Game Bar's widget switcher. Only bridge the
            // content navigation keys, with repetition for directions only.
            string? action = GamepadAction(e.OriginalKey);
            if (action == null || View.Visibility != Visibility.Visible || View.CoreWebView2 == null) return;
            if (View.Source?.AbsoluteUri != HudUrl.AbsoluteUri) return;
            e.Handled = true;
            if ((action == "a" || action == "b") && e.KeyStatus.WasKeyDown) return;
            try
            {
                // `action` comes exclusively from the fixed mapping above.
                await View.CoreWebView2.ExecuteScriptAsync(
                    "window.dispatchEvent(new CustomEvent('sofa-gamepad',{detail:'" + action + "'}))");
            }
            catch (System.Runtime.InteropServices.COMException)
            {
                // The WebView may close while a routed key is in flight.
            }
        }

        private void Retry_Click(object sender, RoutedEventArgs e)
        {
            View.Source = HudUrl;
        }
    }
}

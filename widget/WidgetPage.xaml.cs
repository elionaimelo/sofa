using System;
using Microsoft.Gaming.XboxGameBar;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace Sofa.Widget
{
    /// <summary>Hosts the HUD page served by Sofa (src-tauri/src/hud_server.rs); `widget=1` hides its own chrome.</summary>
    public sealed partial class WidgetPage : Page
    {
        // Fixed port, see hud_server::PORT.
        private static readonly Uri HudUrl = new Uri("http://127.0.0.1:47811/?hud=1&widget=1");
        private XboxGameBarWidget? widget;

        public WidgetPage()
        {
            InitializeComponent();
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
        }

        private void Retry_Click(object sender, RoutedEventArgs e)
        {
            View.Source = HudUrl;
        }
    }
}

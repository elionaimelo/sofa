using Microsoft.Gaming.XboxGameBar;
using Windows.ApplicationModel.Activation;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace Sofa.Widget
{
    /// <summary>Game Bar activates the widget by protocol (ms-gamebarwidget); there is no normal launch.</summary>
    sealed partial class App : Application
    {
        // Must outlive the window, or Game Bar loses the widget.
        private XboxGameBarWidget? widget;

        public App()
        {
            // WinUI 2's WebView2 has no DefaultBackgroundColor property; this avoids a white
            // flash before the HUD page paints (AARRGGBB, Sofa's HUD background).
            System.Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "FF1B2029");
            InitializeComponent();
        }

        protected override void OnActivated(IActivatedEventArgs args)
        {
            if (args.Kind != ActivationKind.Protocol) return;
            if (((IProtocolActivatedEventArgs)args).Uri.Scheme != "ms-gamebarwidget") return;
            // Repeat activations reuse the existing widget; only a launch creates one.
            if (args is not XboxGameBarWidgetActivatedEventArgs widgetArgs || !widgetArgs.IsLaunchActivation) return;

            var frame = new Frame();
            Window.Current.Content = frame;
            widget = new XboxGameBarWidget(widgetArgs, Window.Current.CoreWindow, frame);
            frame.Navigate(typeof(WidgetPage), widget);
            Window.Current.Closed += (_, _) => widget = null;
            Window.Current.Activate();
        }
    }
}

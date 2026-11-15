# Branch Desktop Probe

This diagnostic checks whether regular ChatGPT Chat on macOS exposes a new assistant reply and a reliable end to streaming through Accessibility. The menu bar app samples one selected test window. It has no network access in its code and does not save or sync replies. It copies only diagnostic flags when you click **Copy results**.

Build locally with Swift 6.2 or later:

```sh
cd desktop
swift test
sh build-probe.sh
open 'build/Branch Desktop Probe.app'
```

1. From the probe, click **Copy baseline prompt**. Paste and send it in a new regular **Chat** in the ChatGPT macOS app. Wait for the reply, then pop that chat out into its own window.
2. In the probe, click **Request Accessibility Access…** and enable **Branch Desktop Probe** under **System Settings → Privacy & Security → Accessibility**. Click **Find ChatGPT windows**, select the test window, and click **Watch selected window**.
3. When the probe finds the baseline, click **Copy streaming prompt** and send it in the same ChatGPT window. Leave that window open until the probe reports a result. Click **Copy results** to share the diagnostic flags.

A pass requires an idle baseline, a new reply with both markers, and a stop control that appeared during the reply and then disappeared. The probe checks the same window, title, and chat identity if the app exposes it. A timeout is inconclusive. It can mean the app did not expose a control or reply text in the expected form. The report distinguishes those cases. For a fresh run, quit the probe from the **Branch** menu and reopen it to generate new markers. Remove its Accessibility access from System Settings when you are done testing.

package expo.modules.activitylauncher

import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Starts another app's activity and returns as soon as Android accepts the launch.
 *
 * Why not expo-intent-launcher's `startActivityAsync`: it launches with `startActivityForResult`
 * and keeps ONE pending promise until the result arrives. To deliver that result Android pauses
 * and resumes this app, which React Native reports as "the app came back to the foreground" and
 * which starts a sync; and while the result is still pending, the next launch is rejected with
 * "IntentLauncher activity is already started". Opening a folder in My Files expects no result,
 * so this launches with a plain `startActivity` and keeps nothing pending.
 */
class ActivityLauncherModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ActivityLauncher")

    // Rejects when no app handles the action (ActivityNotFoundException) or there is no activity.
    AsyncFunction("startActivity") { action: String, extras: Map<String, String>, flags: Int, promise: Promise ->
      val intent = Intent(action).addFlags(flags)
      extras.forEach { (key, value) -> intent.putExtra(key, value) }
      appContext.throwingActivity.startActivity(intent)
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)
  }
}

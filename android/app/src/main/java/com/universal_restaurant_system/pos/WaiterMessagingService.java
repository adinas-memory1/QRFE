package com.universal_restaurant_system.pos;

import android.app.ActivityManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.RingtoneManager;
import android.os.PowerManager;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Data-only FCM: native tray when screen off / app backgrounded; haptic when interactive foreground.
 */
public class WaiterMessagingService extends MessagingService {

    private static final AtomicInteger NOTIFICATION_ID = new AtomicInteger(1000);

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (isGuestWaiterCall(data)) {
            handleGuestWaiterCall(data);
        } else if (isWaiterPickupEvent(data)) {
            handlePickupCall(data);
        }

        super.onMessageReceived(remoteMessage);
    }

    private void handleGuestWaiterCall(Map<String, String> data) {
        String restaurantId = data.get("restaurantId");
        WaiterCallNotificationChannels.ensureGuestWaiterChannel(
            getApplicationContext(),
            restaurantId,
            data.get("restaurantName")
        );

        // Screen-off with app still "foreground" must still post a swipeable tray notification.
        if (shouldShowTrayNotification()) {
            showGuestWaiterNotification(data);
        } else {
            PickupAlertFeedback.alert(getApplicationContext(), "fcm-guest-foreground");
        }
    }

    private void handlePickupCall(Map<String, String> data) {
        if (shouldShowTrayNotification()) {
            WaiterCallNotificationChannels.ensurePickupChannel(getApplicationContext());
            showPickupNotification(data);
        } else {
            PickupAlertFeedback.alert(getApplicationContext(), "fcm-foreground");
        }
    }

    private static boolean isGuestWaiterCall(Map<String, String> data) {
        if (data == null) {
            return false;
        }
        return "WaiterCall".equals(data.get("eventType"));
    }

    private static boolean isWaiterPickupEvent(Map<String, String> data) {
        if (data == null) {
            return false;
        }
        String eventType = data.get("eventType");
        return "KitchenWaiterCall".equals(eventType) || "BarWaiterCall".equals(eventType);
    }

    /**
     * Post tray when the display is off or the process is not the interactive top app.
     * ActivityManager alone is true while the screen is locked with the POS still resumed.
     */
    private boolean shouldShowTrayNotification() {
        if (!isDisplayInteractive()) {
            return true;
        }
        return !isAppInForeground();
    }

    private boolean isDisplayInteractive() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isInteractive();
    }

    private boolean isAppInForeground() {
        ActivityManager.RunningAppProcessInfo info = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(info);
        return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
            || info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
    }

    private void showGuestWaiterNotification(Map<String, String> data) {
        String channelId = data.get("channelId");
        if (channelId == null || channelId.isEmpty()) {
            channelId = GuestWaiterChannelIds.forRestaurantId(data.get("restaurantId"));
        }
        showAlertNotification(data, channelId, "Table", "Guest is calling the waiter");
    }

    private void showPickupNotification(Map<String, String> data) {
        String eventType = data.get("eventType");
        boolean isBar = "BarWaiterCall".equals(eventType);
        String defaultTitle = isBar ? "Bar" : "Kitchen";
        String defaultBody = isBar ? "Bar order ready for pickup" : "Order ready for pickup";
        showAlertNotification(data, MainActivity.WAITER_CALL_CHANNEL_ID, defaultTitle, defaultBody);
    }

    private void showAlertNotification(
        Map<String, String> data,
        String channelId,
        String defaultTitle,
        String defaultBody
    ) {
        Context context = getApplicationContext();
        String title = data.get("title");
        String body = data.get("body");
        if (title == null || title.isEmpty()) {
            title = defaultTitle;
        }
        if (body == null || body.isEmpty()) {
            body = defaultBody;
        }

        Intent launch = new Intent(context, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        android.net.Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) {
            sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setOnlyAlertOnce(false)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setSound(sound)
            .setVibrate(PickupVibrator.PICKUP_VIBRATE_PATTERN);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID.incrementAndGet(), builder.build());
        }

        PickupAlertFeedback.alert(context, "after-tray");
    }
}

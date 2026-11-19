package com.conta999.abctodoplanner;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 端末内のカレンダー（CalendarContract）へ終日予定を書き込むプラグイン。
 * Google アカウントのカレンダーを選べば、同期は Google カレンダー側（端末の同期機能）が行う。
 * ネットワーク通信は一切しない。
 *
 * 重複防止: 予定の説明欄の最終行に「abc-task:<タスクID>」の目印を入れ、
 * 選択中カレンダーの予定から目印で既存予定を探して、変更があれば更新・なければスキップする。
 */
@CapacitorPlugin(
    name = "DeviceCalendar",
    permissions = {
        @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR })
    }
)
public class DeviceCalendarPlugin extends Plugin {

    private static final String MARKER_PREFIX = "abc-task:";
    private static final Pattern MARKER = Pattern.compile("abc-task:([A-Za-z0-9_-]+)");
    private static final String CODE_PERMISSION = "PERMISSION_DENIED";
    private static final String CODE_FAILED = "FAILED";
    private static final long DAY_MS = 24L * 60 * 60 * 1000;

    private final Executor executor = Executors.newSingleThreadExecutor();

    private boolean hasCalendarPermission() {
        return getPermissionState("calendar") == PermissionState.GRANTED;
    }

    /** アプリの詳細設定画面（権限を手動で許可する場所）を開く */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("設定画面を開けませんでした: " + e.getMessage(), CODE_FAILED, e);
        }
    }

    @PluginMethod
    public void listCalendars(PluginCall call) {
        if (!hasCalendarPermission()) {
            call.reject("Calendar permission not granted", CODE_PERMISSION);
            return;
        }
        executor.execute(() -> {
            String[] projection = new String[] {
                CalendarContract.Calendars._ID,
                CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                CalendarContract.Calendars.ACCOUNT_NAME,
                CalendarContract.Calendars.ACCOUNT_TYPE,
                CalendarContract.Calendars.OWNER_ACCOUNT,
                CalendarContract.Calendars.IS_PRIMARY,
                CalendarContract.Calendars.CALENDAR_COLOR,
                CalendarContract.Calendars.VISIBLE,
            };
            String selection = CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + " >= ?";
            String[] args = new String[] { String.valueOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) };
            JSArray list = new JSArray();
            try (Cursor c = getContext().getContentResolver().query(
                CalendarContract.Calendars.CONTENT_URI, projection, selection, args, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        JSObject o = new JSObject();
                        String name = c.getString(1);
                        String account = c.getString(2);
                        String owner = c.getString(4);
                        boolean primary = !c.isNull(5) && c.getInt(5) == 1;
                        if (!primary && account != null && account.equals(owner) && account.equals(name)) primary = true;
                        o.put("id", String.valueOf(c.getLong(0)));
                        o.put("displayName", name == null ? "" : name);
                        o.put("accountName", account == null ? "" : account);
                        o.put("accountType", c.getString(3) == null ? "" : c.getString(3));
                        o.put("isPrimary", primary);
                        o.put("color", c.isNull(6) ? null : String.format("#%06X", 0xFFFFFF & c.getInt(6)));
                        o.put("visible", c.isNull(7) || c.getInt(7) == 1);
                        list.put(o);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("calendars", list);
                call.resolve(ret);
            } catch (SecurityException e) {
                call.reject("Calendar permission not granted", CODE_PERMISSION, e);
            } catch (Exception e) {
                call.reject("カレンダー一覧を取得できませんでした: " + e.getMessage(), CODE_FAILED, e);
            }
        });
    }

    /** "YYYY-MM-DD" → その日の UTC 0:00（ミリ秒）。終日予定は UTC で保存するのが CalendarContract の決まり */
    private static long utcMidnight(String date) {
        String[] p = date.split("-");
        Calendar cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        cal.clear();
        cal.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 0, 0, 0);
        return cal.getTimeInMillis();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    @PluginMethod
    public void upsertEvents(PluginCall call) {
        if (!hasCalendarPermission()) {
            call.reject("Calendar permission not granted", CODE_PERMISSION);
            return;
        }
        final String calendarIdStr = call.getString("calendarId");
        final JSArray events = call.getArray("events", new JSArray());
        if (calendarIdStr == null || calendarIdStr.isEmpty()) {
            call.reject("calendarId is required", CODE_FAILED);
            return;
        }
        executor.execute(() -> {
            ContentResolver cr = getContext().getContentResolver();
            long calendarId;
            try {
                calendarId = Long.parseLong(calendarIdStr);
            } catch (NumberFormatException e) {
                call.reject("invalid calendarId", CODE_FAILED);
                return;
            }
            // 1) 選択カレンダー内の、このアプリが登録した予定（目印付き）を集める
            Map<String, long[]> existingIds = new HashMap<>(); // taskId -> {eventId, dtstart, allDay}
            Map<String, String[]> existingText = new HashMap<>(); // taskId -> {title, description}
            String[] projection = new String[] {
                CalendarContract.Events._ID,
                CalendarContract.Events.TITLE,
                CalendarContract.Events.DESCRIPTION,
                CalendarContract.Events.DTSTART,
                CalendarContract.Events.ALL_DAY,
            };
            String selection = CalendarContract.Events.CALENDAR_ID + " = ? AND "
                + CalendarContract.Events.DELETED + " = 0 AND "
                + CalendarContract.Events.DESCRIPTION + " LIKE ?";
            String[] args = new String[] { String.valueOf(calendarId), "%" + MARKER_PREFIX + "%" };
            try (Cursor c = cr.query(CalendarContract.Events.CONTENT_URI, projection, selection, args, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        String desc = nz(c.getString(2));
                        Matcher m = MARKER.matcher(desc);
                        if (!m.find()) continue;
                        String taskId = m.group(1);
                        if (existingIds.containsKey(taskId)) continue;
                        existingIds.put(taskId, new long[] { c.getLong(0), c.isNull(3) ? 0 : c.getLong(3), c.isNull(4) ? 0 : c.getInt(4) });
                        existingText.put(taskId, new String[] { nz(c.getString(1)), desc });
                    }
                }
            } catch (SecurityException e) {
                call.reject("Calendar permission not granted", CODE_PERMISSION, e);
                return;
            } catch (Exception e) {
                call.reject("既存の予定を確認できませんでした: " + e.getMessage(), CODE_FAILED, e);
                return;
            }

            // 2) 登録 or 更新 or スキップ
            int created = 0, updated = 0, skipped = 0, failed = 0;
            JSONArray errors = new JSONArray();
            for (int i = 0; i < events.length(); i++) {
                String taskId = "";
                try {
                    JSONObject ev = events.getJSONObject(i);
                    taskId = ev.getString("taskId");
                    String title = ev.optString("title", "");
                    String notes = ev.optString("description", "").trim();
                    String date = ev.getString("date");
                    String description = (notes.isEmpty() ? "" : notes + "\n\n") + MARKER_PREFIX + taskId;
                    long start = utcMidnight(date);

                    ContentValues v = new ContentValues();
                    v.put(CalendarContract.Events.TITLE, title);
                    v.put(CalendarContract.Events.DESCRIPTION, description);
                    v.put(CalendarContract.Events.DTSTART, start);
                    v.put(CalendarContract.Events.DTEND, start + DAY_MS);
                    v.put(CalendarContract.Events.ALL_DAY, 1);
                    v.put(CalendarContract.Events.EVENT_TIMEZONE, "UTC");
                    v.put(CalendarContract.Events.AVAILABILITY, CalendarContract.Events.AVAILABILITY_FREE);

                    long[] ex = existingIds.get(taskId);
                    if (ex != null) {
                        String[] txt = existingText.get(taskId);
                        boolean same = txt[0].equals(title) && txt[1].equals(description) && ex[1] == start && ex[2] == 1;
                        if (same) {
                            skipped++;
                        } else {
                            Uri uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, ex[0]);
                            int n = cr.update(uri, v, null, null);
                            if (n > 0) updated++;
                            else throw new IllegalStateException("update returned 0");
                        }
                    } else {
                        v.put(CalendarContract.Events.CALENDAR_ID, calendarId);
                        Uri inserted = cr.insert(CalendarContract.Events.CONTENT_URI, v);
                        if (inserted == null) throw new IllegalStateException("insert returned null");
                        created++;
                    }
                } catch (SecurityException e) {
                    call.reject("Calendar permission not granted", CODE_PERMISSION, e);
                    return;
                } catch (Exception e) {
                    failed++;
                    errors.put(taskId + ": " + e.getClass().getSimpleName() + " " + e.getMessage());
                }
            }
            JSObject ret = new JSObject();
            ret.put("created", created);
            ret.put("updated", updated);
            ret.put("skipped", skipped);
            ret.put("failed", failed);
            ret.put("errors", errors);
            call.resolve(ret);
        });
    }
}

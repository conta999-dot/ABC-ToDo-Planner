package com.conta999.abctodoplanner;

import android.Manifest;
import android.accounts.Account;
import android.os.Bundle;
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

import org.json.JSONObject;

import java.util.Calendar;
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
 * 予定には目印を入れず、新規登録だけを行う。登録済みかどうかはアプリ側のタスクの
 * エクスポート済みフラグで管理し、登録後の予定には一切触らない（更新・削除しない）。
 */
@CapacitorPlugin(
    name = "DeviceCalendar",
    permissions = {
        @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR })
    }
)
public class DeviceCalendarPlugin extends Plugin {

    private static final String MARKER_PREFIX = "abc-task:";
    /** v0.5.1 の目印（後片付け専用。新しい予定には入れない） */
    private static final Pattern MARKER = Pattern.compile("abc-task:([A-Za-z0-9_-]+)");
    private static final Pattern MARKER_LINE = Pattern.compile("\\s*abc-task:[A-Za-z0-9_-]+[ \\t]*");
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
                CalendarContract.Calendars.SYNC_EVENTS,
                CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
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
                        o.put("syncEvents", c.isNull(8) || c.getInt(8) == 1);
                        o.put("accessLevel", c.isNull(9) ? 0 : c.getInt(9));
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

    private static ContentValues eventValues(String title, String description, long start) {
        ContentValues v = new ContentValues();
        v.put(CalendarContract.Events.TITLE, title);
        v.put(CalendarContract.Events.DESCRIPTION, description);
        v.put(CalendarContract.Events.DTSTART, start);
        v.put(CalendarContract.Events.DTEND, start + DAY_MS);
        v.put(CalendarContract.Events.ALL_DAY, 1);
        v.put(CalendarContract.Events.EVENT_TIMEZONE, "UTC");
        v.put(CalendarContract.Events.AVAILABILITY, CalendarContract.Events.AVAILABILITY_FREE);
        return v;
    }

    /**
     * 予定の新規登録だけを行う（更新・削除・検索はしない）。
     * どのタスクを登録済みかは、アプリ側のタスクの「エクスポート済みフラグ」で管理する。
     * events[]: { taskId, title, description, date }
     * 戻り値 results[]: { taskId, status: created|failed, error? }
     */
    @PluginMethod
    public void insertEvents(PluginCall call) {
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
            JSArray results = new JSArray();
            for (int i = 0; i < events.length(); i++) {
                JSObject r = new JSObject();
                String taskId = "";
                try {
                    JSONObject ev = events.getJSONObject(i);
                    taskId = ev.getString("taskId");
                    r.put("taskId", taskId);
                    ContentValues v = eventValues(
                        ev.optString("title", ""),
                        ev.optString("description", "").trim(),
                        utcMidnight(ev.getString("date")));
                    v.put(CalendarContract.Events.CALENDAR_ID, calendarId);
                    Uri inserted = cr.insert(CalendarContract.Events.CONTENT_URI, v);
                    if (inserted == null) throw new IllegalStateException("insert returned null");
                    long newId = ContentUris.parseId(inserted);
                    // 登録した行を読み戻して、正しく入ったか確認する
                    JSObject check = readBack(cr, newId);
                    if (check == null) throw new IllegalStateException("inserted row not found (id=" + newId + ")");
                    r.put("status", "created");
                    r.put("eventId", String.valueOf(newId));
                    r.put("check", check);
                } catch (SecurityException e) {
                    call.reject("Calendar permission not granted", CODE_PERMISSION, e);
                    return;
                } catch (Exception e) {
                    r.put("taskId", taskId);
                    r.put("status", "failed");
                    r.put("error", e.getClass().getSimpleName() + " " + e.getMessage());
                }
                results.put(r);
            }
            JSObject ret = new JSObject();
            ret.put("results", results);
            ret.put("calendar", calendarInfo(cr, calendarId));
            // 端末の Google カレンダー同期にすぐアップロードしてもらう（失敗しても無視）
            requestCalendarSync(cr, calendarId);
            call.resolve(ret);
        });
    }

    /** 予定 1 件を読み戻す（存在しなければ null） */
    private static JSObject readBack(ContentResolver cr, long eventId) {
        String[] projection = new String[] {
            CalendarContract.Events._ID,
            CalendarContract.Events.CALENDAR_ID,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DTEND,
            CalendarContract.Events.ALL_DAY,
            CalendarContract.Events.EVENT_TIMEZONE,
            CalendarContract.Events.DELETED,
        };
        try (Cursor c = cr.query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), projection, null, null, null)) {
            if (c == null || !c.moveToFirst()) return null;
            JSObject o = new JSObject();
            o.put("eventId", String.valueOf(c.getLong(0)));
            o.put("calendarId", String.valueOf(c.getLong(1)));
            o.put("title", nz(c.getString(2)));
            o.put("start", utcDate(c.getLong(3)));
            o.put("end", c.isNull(4) ? "" : utcDate(c.getLong(4)));
            o.put("allDay", !c.isNull(5) && c.getInt(5) == 1);
            o.put("timezone", nz(c.getString(6)));
            o.put("deleted", !c.isNull(7) && c.getInt(7) == 1);
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    /** UTC ミリ秒 → "YYYY-MM-DD"（終日予定の日付） */
    private static String utcDate(long ms) {
        Calendar cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        cal.setTimeInMillis(ms);
        return String.format("%04d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
    }

    /** カレンダーの名前・アカウント・同期設定 */
    private static JSObject calendarInfo(ContentResolver cr, long calendarId) {
        JSObject o = new JSObject();
        String[] projection = new String[] {
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.ACCOUNT_TYPE,
            CalendarContract.Calendars.VISIBLE,
            CalendarContract.Calendars.SYNC_EVENTS,
        };
        try (Cursor c = cr.query(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, calendarId), projection, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                o.put("id", String.valueOf(calendarId));
                o.put("displayName", nz(c.getString(0)));
                o.put("accountName", nz(c.getString(1)));
                o.put("accountType", nz(c.getString(2)));
                o.put("visible", c.isNull(3) || c.getInt(3) == 1);
                o.put("syncEvents", c.isNull(4) || c.getInt(4) == 1);
            }
        } catch (Exception ignored) {
            // ignore
        }
        return o;
    }

    private static void requestCalendarSync(ContentResolver cr, long calendarId) {
        try {
            JSObject info = calendarInfo(cr, calendarId);
            String name = info.optString("accountName", "");
            String type = info.optString("accountType", "");
            if (name.isEmpty() || type.isEmpty() || CalendarContract.ACCOUNT_TYPE_LOCAL.equals(type)) return;
            Bundle extras = new Bundle();
            extras.putBoolean(ContentResolver.SYNC_EXTRAS_MANUAL, true);
            extras.putBoolean(ContentResolver.SYNC_EXTRAS_EXPEDITED, true);
            ContentResolver.requestSync(new Account(name, type), CalendarContract.AUTHORITY, extras);
        } catch (Exception ignored) {
            // 同期の依頼に失敗しても、端末の通常の同期で後からアップロードされる
        }
    }

    /**
     * このアプリが登録したと思われる予定を探す（全カレンダー、または指定カレンダー）。
     * 目印は入れていないので、タイトルの先頭がプレフィックスで始まる予定を返す（判定の絞り込みは JS 側で行う）。
     * 読むだけで、何も変更しない。
     * 戻り値 events[]: { eventId, title, date, allDay, calendarId, calendarName, accountName, dirty, synced }
     */
    @PluginMethod
    public void findAppEvents(PluginCall call) {
        if (!hasCalendarPermission()) {
            call.reject("Calendar permission not granted", CODE_PERMISSION);
            return;
        }
        final String prefix = call.getString("prefix", "");
        final String calendarIdStr = call.getString("calendarId", "");
        if (prefix == null || prefix.trim().isEmpty()) {
            call.reject("prefix is required", CODE_FAILED);
            return;
        }
        executor.execute(() -> {
            ContentResolver cr = getContext().getContentResolver();
            JSArray list = new JSArray();
            try {
                StringBuilder sel = new StringBuilder();
                java.util.ArrayList<String> args = new java.util.ArrayList<>();
                sel.append(CalendarContract.Events.DELETED).append(" = 0 AND substr(").append(CalendarContract.Events.TITLE).append(", 1, ?) = ?");
                args.add(String.valueOf(prefix.length()));
                args.add(prefix);
                if (calendarIdStr != null && !calendarIdStr.isEmpty()) {
                    sel.append(" AND ").append(CalendarContract.Events.CALENDAR_ID).append(" = ?");
                    args.add(calendarIdStr);
                }
                String[] projection = new String[] {
                    CalendarContract.Events._ID,
                    CalendarContract.Events.TITLE,
                    CalendarContract.Events.DTSTART,
                    CalendarContract.Events.ALL_DAY,
                    CalendarContract.Events.CALENDAR_ID,
                    CalendarContract.Events.CALENDAR_DISPLAY_NAME,
                    CalendarContract.Events.ACCOUNT_NAME,
                    CalendarContract.Events.DIRTY,
                    CalendarContract.Events._SYNC_ID,
                };
                try (Cursor c = cr.query(CalendarContract.Events.CONTENT_URI, projection, sel.toString(), args.toArray(new String[0]),
                    CalendarContract.Events.DTSTART + " ASC")) {
                    while (c != null && c.moveToNext()) {
                        JSObject o = new JSObject();
                        boolean allDay = !c.isNull(3) && c.getInt(3) == 1;
                        o.put("eventId", String.valueOf(c.getLong(0)));
                        o.put("title", nz(c.getString(1)));
                        o.put("date", allDay ? utcDate(c.getLong(2)) : String.valueOf(c.getLong(2)));
                        o.put("allDay", allDay);
                        o.put("calendarId", String.valueOf(c.getLong(4)));
                        o.put("calendarName", nz(c.getString(5)));
                        o.put("accountName", nz(c.getString(6)));
                        o.put("dirty", !c.isNull(7) && c.getInt(7) == 1);
                        o.put("synced", !c.isNull(8) && !nz(c.getString(8)).isEmpty());
                        list.put(o);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("events", list);
                call.resolve(ret);
            } catch (SecurityException e) {
                call.reject("Calendar permission not granted", CODE_PERMISSION, e);
            } catch (Exception e) {
                call.reject("予定の検索に失敗しました: " + e.getMessage(), CODE_FAILED, e);
            }
        });
    }

    /**
     * 利用者が一覧で確認して選んだ予定だけを削除する（自動では呼ばない）。
     * アプリとして削除するので、Google カレンダーにも削除が同期される。
     */
    @PluginMethod
    public void deleteEvents(PluginCall call) {
        if (!hasCalendarPermission()) {
            call.reject("Calendar permission not granted", CODE_PERMISSION);
            return;
        }
        final JSArray ids = call.getArray("eventIds", new JSArray());
        executor.execute(() -> {
            ContentResolver cr = getContext().getContentResolver();
            int deleted = 0;
            JSArray errors = new JSArray();
            java.util.HashSet<Long> calendars = new java.util.HashSet<>();
            for (int i = 0; i < ids.length(); i++) {
                try {
                    long id = Long.parseLong(ids.getString(i));
                    JSObject row = readBack(cr, id);
                    if (row != null) calendars.add(Long.parseLong(row.getString("calendarId")));
                    int n = cr.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, id), null, null);
                    if (n > 0) deleted += n;
                } catch (SecurityException e) {
                    call.reject("Calendar permission not granted", CODE_PERMISSION, e);
                    return;
                } catch (Exception e) {
                    errors.put(e.getClass().getSimpleName() + " " + e.getMessage());
                }
            }
            for (Long cal : calendars) requestCalendarSync(cr, cal);
            JSObject ret = new JSObject();
            ret.put("deleted", deleted);
            ret.put("errors", errors);
            call.resolve(ret);
        });
    }

    /**
     * v0.5.1 で説明欄に入れていた目印行「abc-task:<ID>」を、選択カレンダー内の予定から取り除く（後片付け）。
     * 取り除いた予定は { taskId, eventId } として返し、アプリ側のエクスポート記録に引き継ぐ（重複登録を防ぐ）。
     */
    @PluginMethod
    public void cleanLegacyMarkers(PluginCall call) {
        if (!hasCalendarPermission()) {
            call.reject("Calendar permission not granted", CODE_PERMISSION);
            return;
        }
        final String calendarIdStr = call.getString("calendarId");
        if (calendarIdStr == null || calendarIdStr.isEmpty()) {
            call.reject("calendarId is required", CODE_FAILED);
            return;
        }
        executor.execute(() -> {
            ContentResolver cr = getContext().getContentResolver();
            JSArray adopted = new JSArray();
            try {
                long calendarId = Long.parseLong(calendarIdStr);
                String selection = CalendarContract.Events.CALENDAR_ID + " = ? AND "
                    + CalendarContract.Events.DELETED + " = 0 AND "
                    + CalendarContract.Events.DESCRIPTION + " LIKE ?";
                String[] args = new String[] { String.valueOf(calendarId), "%" + MARKER_PREFIX + "%" };
                String[] projection = new String[] { CalendarContract.Events._ID, CalendarContract.Events.DESCRIPTION };
                try (Cursor c = cr.query(CalendarContract.Events.CONTENT_URI, projection, selection, args, null)) {
                    while (c != null && c.moveToNext()) {
                        long eventId = c.getLong(0);
                        String desc = nz(c.getString(1));
                        Matcher m = MARKER.matcher(desc);
                        if (!m.find()) continue;
                        String taskId = m.group(1);
                        String cleaned = MARKER_LINE.matcher(desc).replaceAll("").replaceAll("\\s+$", "");
                        ContentValues v = new ContentValues();
                        v.put(CalendarContract.Events.DESCRIPTION, cleaned);
                        cr.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), v, null, null);
                        JSObject o = new JSObject();
                        o.put("taskId", taskId);
                        o.put("eventId", String.valueOf(eventId));
                        adopted.put(o);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("adopted", adopted);
                call.resolve(ret);
            } catch (SecurityException e) {
                call.reject("Calendar permission not granted", CODE_PERMISSION, e);
            } catch (Exception e) {
                call.reject("古い目印の削除に失敗しました: " + e.getMessage(), CODE_FAILED, e);
            }
        });
    }
}

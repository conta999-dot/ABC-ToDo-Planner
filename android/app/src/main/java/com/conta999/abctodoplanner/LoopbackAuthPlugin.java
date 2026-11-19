package com.conta999.abctodoplanner;

import android.app.Activity;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "LoopbackAuth")
public class LoopbackAuthPlugin extends Plugin {
    private static final int DEFAULT_PORT = 41827;
    private static final String DEFAULT_PATH = "/auth/callback";

    private ServerSocket serverSocket;
    private Thread acceptThread;
    private PluginCall pendingWait;
    private String capturedUri;
    private String expectedPath = DEFAULT_PATH;
    private int boundPort = DEFAULT_PORT;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable timeoutRunnable;
    private final Object lock = new Object();

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", DEFAULT_PORT);
        String path = call.getString("path", DEFAULT_PATH);
        if (path == null || path.isEmpty()) {
            path = DEFAULT_PATH;
        }
        stopServerInternal();
        synchronized (lock) {
            capturedUri = null;
        }
        try {
            ServerSocket socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port));
            socket.setSoTimeout(1000);
            serverSocket = socket;
            boundPort = socket.getLocalPort();
            expectedPath = path;
            startAcceptThread();
            JSObject ret = new JSObject();
            ret.put("port", boundPort);
            ret.put("continueUri", "http://127.0.0.1:" + boundPort + path);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("ループバックサーバを起動できませんでした: " + e.getMessage());
        }
    }

    @PluginMethod
    public void waitForCallback(PluginCall call) {
        int timeoutMs = call.getInt("timeoutMs", 180000);
        synchronized (lock) {
            if (capturedUri != null) {
                JSObject ret = new JSObject();
                ret.put("requestUri", capturedUri);
                capturedUri = null;
                call.resolve(ret);
                return;
            }
            if (pendingWait != null) {
                pendingWait.reject("別のログイン待ちが既にあります。");
            }
            call.setKeepAlive(true);
            pendingWait = call;
        }
        if (timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
        }
        timeoutRunnable = () -> {
            PluginCall waiting;
            synchronized (lock) {
                waiting = pendingWait;
                pendingWait = null;
            }
            if (waiting != null) {
                waiting.reject("ログインが時間切れになりました。もう一度お試しください。");
            }
        };
        mainHandler.postDelayed(timeoutRunnable, Math.max(5_000, timeoutMs));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopServerInternal();
        call.resolve();
    }

    private void startAcceptThread() {
        acceptThread = new Thread(this::acceptLoop, "abc-loopback-auth");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    private void acceptLoop() {
        while (serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                handleClient(client);
            } catch (SocketTimeoutException ignored) {
                // periodic wake so we can notice server close
            } catch (Exception e) {
                if (serverSocket == null || serverSocket.isClosed()) {
                    break;
                }
            }
        }
    }

    private void handleClient(Socket client) {
        try {
            client.setSoTimeout(5000);
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII)
            );
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) {
                client.close();
                return;
            }
            String[] parts = requestLine.split(" ");
            String rawPath = parts.length >= 2 ? parts[1] : "/";
            String pathOnly = rawPath.contains("?") ? rawPath.substring(0, rawPath.indexOf('?')) : rawPath;

            // Drain headers
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                // ignore
            }

            boolean isCallback = pathOnly.equals(expectedPath) || rawPath.startsWith(expectedPath + "?");
            if (!isCallback) {
                writeResponse(client, 404, "text/plain; charset=UTF-8", "Not Found");
                client.close();
                return;
            }

            String requestUri = "http://127.0.0.1:" + boundPort + rawPath;
            writeResponse(client, 200, "text/html; charset=UTF-8", successHtml());
            client.close();
            onCallbackCaptured(requestUri);
        } catch (Exception e) {
            try {
                client.close();
            } catch (Exception ignored) {
            }
        }
    }

    private void onCallbackCaptured(String requestUri) {
        PluginCall waiting;
        synchronized (lock) {
            capturedUri = requestUri;
            waiting = pendingWait;
            pendingWait = null;
        }
        if (timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
            timeoutRunnable = null;
        }
        if (waiting != null) {
            JSObject ret = new JSObject();
            ret.put("requestUri", requestUri);
            waiting.resolve(ret);
        }
        bringAppToFront();
    }

    private void bringAppToFront() {
        mainHandler.post(() -> {
            Activity activity = getActivity();
            if (activity == null) {
                return;
            }
            Intent intent = new Intent(activity, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            intent.setData(android.net.Uri.parse("com.conta999.abctodoplanner://auth-complete"));
            activity.startActivity(intent);
        });
    }

    private void writeResponse(Socket client, int status, String contentType, String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : "Error";
        String headers =
            "HTTP/1.1 " + status + " " + reason + "\r\n" +
            "Content-Type: " + contentType + "\r\n" +
            "Content-Length: " + bytes.length + "\r\n" +
            "Connection: close\r\n" +
            "Cache-Control: no-store\r\n\r\n";
        BufferedOutputStream out = new BufferedOutputStream(client.getOutputStream());
        out.write(headers.getBytes(StandardCharsets.US_ASCII));
        out.write(bytes);
        out.flush();
    }

    private String successHtml() {
        return "<!DOCTYPE html><html lang=\"ja\"><head><meta charset=\"UTF-8\">"
            + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            + "<title>ABC Planner</title>"
            + "<style>body{font-family:sans-serif;background:#fafafa;color:#18181b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center;}a{color:#18181b;}</style>"
            + "</head><body><div>"
            + "<p style=\"font-size:18px;font-weight:700;\">ログインしました</p>"
            + "<p>この画面を閉じて、ABC Planner に戻ってください。</p>"
            + "<p><a href=\"com.conta999.abctodoplanner://auth-complete\">アプリに戻る</a></p>"
            + "</div><script>setTimeout(function(){location.replace('com.conta999.abctodoplanner://auth-complete');},300);</script></body></html>";
    }

    private void stopServerInternal() {
        if (timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
            timeoutRunnable = null;
        }
        PluginCall waiting;
        synchronized (lock) {
            waiting = pendingWait;
            pendingWait = null;
        }
        if (waiting != null) {
            waiting.reject("ログインがキャンセルされました。");
        }
        ServerSocket socket = serverSocket;
        serverSocket = null;
        if (socket != null) {
            try {
                socket.close();
            } catch (Exception ignored) {
            }
        }
        if (acceptThread != null) {
            try {
                acceptThread.join(500);
            } catch (Exception ignored) {
            }
            acceptThread = null;
        }
    }

    @Override
    public void handleOnDestroy() {
        stopServerInternal();
        super.handleOnDestroy();
    }
}

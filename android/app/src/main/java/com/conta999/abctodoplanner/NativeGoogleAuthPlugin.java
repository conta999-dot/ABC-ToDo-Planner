package com.conta999.abctodoplanner;


import androidx.annotation.NonNull;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * Native Google sign-in via Android Credential Manager (v0.6.3: Drive authorization removed).
 * No google-services.json is used:
 * the Web OAuth client ID is passed in from JS at runtime.
 */
@CapacitorPlugin(name = "NativeGoogleAuth")
public class NativeGoogleAuthPlugin extends Plugin {

    private static final String CODE_CANCELLED = "CANCELLED";
    private static final String CODE_NO_ACCOUNT = "NO_ACCOUNT";
    private static final String CODE_MISCONFIGURED = "MISCONFIGURED";
    private static final String CODE_NEED_INTERACTION = "NEED_INTERACTION";
    private static final String CODE_FAILED = "FAILED";

    private final Executor executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void signIn(PluginCall call) {
        String serverClientId = call.getString("serverClientId");
        if (serverClientId == null || serverClientId.isEmpty() || serverClientId.contains("REPLACE_ME")) {
            call.reject("serverClientId is not configured", CODE_MISCONFIGURED);
            return;
        }

        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(serverClientId).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build();

        CredentialManager manager = CredentialManager.create(getContext());
        manager.getCredentialAsync(
            getActivity(),
            request,
            null,
            executor,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential credential = response.getCredential();
                    if (credential instanceof CustomCredential
                        && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                        try {
                            GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                            JSObject ret = new JSObject();
                            ret.put("idToken", google.getIdToken());
                            ret.put("email", google.getId());
                            ret.put("displayName", google.getDisplayName());
                            call.resolve(ret);
                        } catch (Exception e) {
                            call.reject("Invalid Google ID token response: " + e.getMessage(), CODE_FAILED, e, details(e, null));
                        }
                    } else {
                        JSObject d = new JSObject();
                        d.put("type", credential.getType());
                        d.put("className", credential.getClass().getName());
                        call.reject("Unexpected credential type: " + credential.getType(), CODE_FAILED, null, d);
                    }
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    call.reject(describe(e), classify(e), e, details(e, e.getType()));
                }
            }
        );
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        CredentialManager manager = CredentialManager.create(getContext());
        manager.clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            null,
            executor,
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void unused) {
                    call.resolve();
                }

                @Override
                public void onError(@NonNull ClearCredentialException e) {
                    // Not fatal: Firebase sign-out still happens in JS.
                    call.resolve();
                }
            }
        );
    }

    /** Raw diagnostic details passed to JS (shown to the user so they can screenshot it). */
    private static JSObject details(Exception e, String type) {
        JSObject d = new JSObject();
        d.put("className", e.getClass().getName());
        if (type != null) d.put("type", type);
        d.put("message", e.getMessage() != null ? e.getMessage() : "");
        if (e instanceof ApiException) d.put("statusCode", ((ApiException) e).getStatusCode());
        Throwable cause = e.getCause();
        if (cause != null) {
            d.put("cause", cause.getClass().getSimpleName() + (cause.getMessage() != null ? ": " + cause.getMessage() : ""));
        }
        return d;
    }

    private static String describe(Exception e) {
        String msg = e.getMessage();
        return e.getClass().getSimpleName() + (msg != null ? ": " + msg : "");
    }

    private static boolean looksMisconfigured(String msg) {
        if (msg == null) return false;
        String m = msg.toLowerCase();
        return m.contains("28444") || m.contains("developer console") || m.contains("developer_error")
            || m.contains("10:") || m.contains("[10]") || m.contains("invalid audience")
            || m.contains("serverclientid") || m.contains("client id");
    }

    private static String classify(GetCredentialException e) {
        if (e instanceof GetCredentialCancellationException) return CODE_CANCELLED;
        if (e instanceof NoCredentialException) return CODE_NO_ACCOUNT;
        if (looksMisconfigured(e.getMessage())) return CODE_MISCONFIGURED;
        return CODE_FAILED;
    }

    private static String classifyApi(Exception e) {
        if (e instanceof ApiException) {
            int status = ((ApiException) e).getStatusCode();
            if (status == CommonStatusCodes.DEVELOPER_ERROR) return CODE_MISCONFIGURED;
            if (status == CommonStatusCodes.CANCELED || status == 12501) return CODE_CANCELLED;
            if (status == CommonStatusCodes.SIGN_IN_REQUIRED) return CODE_NO_ACCOUNT;
        }
        if (looksMisconfigured(e.getMessage())) return CODE_MISCONFIGURED;
        return CODE_FAILED;
    }
}

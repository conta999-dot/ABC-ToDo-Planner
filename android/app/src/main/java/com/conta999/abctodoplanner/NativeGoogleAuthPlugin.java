package com.conta999.abctodoplanner;

import android.app.PendingIntent;
import android.content.Intent;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
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
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * Native Google sign-in via Android Credential Manager, plus Drive authorization
 * via the Play services AuthorizationClient. No google-services.json is used:
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
    private ActivityResultLauncher<IntentSenderRequest> authorizeLauncher;
    private String pendingAuthorizeCallId;

    @Override
    public void load() {
        authorizeLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            this::handleAuthorizeResult
        );
    }

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
                            call.reject("Invalid Google ID token response: " + e.getMessage(), CODE_FAILED, e);
                        }
                    } else {
                        call.reject("Unexpected credential type: " + credential.getType(), CODE_FAILED);
                    }
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    call.reject(describe(e), classify(e), e);
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

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        List<String> scopeStrings;
        try {
            scopeStrings = call.getArray("scopes", new com.getcapacitor.JSArray()).toList();
        } catch (Exception e) {
            scopeStrings = new ArrayList<>();
        }
        if (scopeStrings.isEmpty()) {
            call.reject("No scopes requested", CODE_FAILED);
            return;
        }
        List<Scope> scopes = new ArrayList<>();
        for (String s : scopeStrings) scopes.add(new Scope(s));

        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(scopes)
            .build();

        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (result.hasResolution()) {
                    if (!interactive) {
                        call.reject("User interaction required", CODE_NEED_INTERACTION);
                        return;
                    }
                    PendingIntent pi = result.getPendingIntent();
                    if (pi == null) {
                        call.reject("Missing authorization resolution", CODE_FAILED);
                        return;
                    }
                    if (pendingAuthorizeCallId != null) {
                        PluginCall prev = bridge.getSavedCall(pendingAuthorizeCallId);
                        if (prev != null) {
                            prev.reject("Superseded by a new authorization request", CODE_CANCELLED);
                            bridge.releaseCall(prev);
                        }
                    }
                    call.setKeepAlive(true);
                    bridge.saveCall(call);
                    pendingAuthorizeCallId = call.getCallbackId();
                    try {
                        authorizeLauncher.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build());
                    } catch (Exception e) {
                        pendingAuthorizeCallId = null;
                        call.setKeepAlive(false);
                        bridge.releaseCall(call);
                        call.reject("Failed to launch authorization UI: " + e.getMessage(), CODE_FAILED, e);
                    }
                } else {
                    resolveToken(call, result);
                }
            })
            .addOnFailureListener(e -> call.reject(describe(e), classifyApi(e), e));
    }

    private void handleAuthorizeResult(ActivityResult activityResult) {
        if (pendingAuthorizeCallId == null) return;
        PluginCall call = bridge.getSavedCall(pendingAuthorizeCallId);
        pendingAuthorizeCallId = null;
        if (call == null) return;
        call.setKeepAlive(false);
        bridge.releaseCall(call);

        Intent data = activityResult.getData();
        if (data == null) {
            call.reject("Authorization cancelled", CODE_CANCELLED);
            return;
        }
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(getActivity())
                .getAuthorizationResultFromIntent(data);
            resolveToken(call, result);
        } catch (ApiException e) {
            call.reject(describe(e), classifyApi(e), e);
        }
    }

    private void resolveToken(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty()) {
            call.reject("No access token returned", CODE_FAILED);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("accessToken", token);
        call.resolve(ret);
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

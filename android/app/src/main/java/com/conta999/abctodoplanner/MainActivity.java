package com.conta999.abctodoplanner;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeGoogleAuthPlugin.class);
        registerPlugin(DeviceCalendarPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

package com.conta999.abcplanner;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LoopbackAuthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

package com.lifepilot.ai;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "LifePilotSpeech",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "speech") }
)
public class SpeechPlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private PluginCall pending;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("speech") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("speech", call, "speechPerm");
    }

    @PermissionCallback
    private void speechPerm(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("speech") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Speech recognition is not available on this phone");
            return;
        }
        if (getPermissionState("speech") != PermissionState.GRANTED) {
            call.reject("Microphone permission is needed so LifePilot can hear you");
            return;
        }
        if (pending != null) {
            pending.reject("Cancelled");
            pending = null;
        }
        pending = call;
        call.setKeepAlive(true);
        String lang = call.getString("language", Locale.getDefault().toLanguageTag());
        getActivity().runOnUiThread(() -> {
            if (recognizer == null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(listener);
            }
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            recognizer.startListening(intent);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) recognizer.stopListening();
        });
        call.resolve();
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}

        @Override
        public void onError(int error) {
            if (pending == null) return;
            String message = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                ? "I didn't hear anything. Try again."
                : error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                    ? "Microphone permission is needed so LifePilot can hear you."
                    : "Speech recognition error (" + error + ")";
            pending.reject(message);
            pending = null;
        }

        @Override
        public void onResults(Bundle results) {
            ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = list != null && !list.isEmpty() ? list.get(0) : "";
            JSObject ret = new JSObject();
            ret.put("text", text);
            if (pending != null) {
                pending.resolve(ret);
                pending = null;
            }
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = list != null && !list.isEmpty() ? list.get(0) : "";
            JSObject ev = new JSObject();
            ev.put("text", text);
            notifyListeners("partial", ev);
        }
    };

    @Override
    protected void handleOnDestroy() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }
}

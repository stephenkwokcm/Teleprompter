#include <napi.h>
#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <AVFoundation/AVFoundation.h>

// Global state for speech recognition
static SFSpeechRecognizer* speechRecognizer = nil;
static SFSpeechAudioBufferRecognitionRequest* recognitionRequest = nil;
static SFSpeechRecognitionTask* recognitionTask = nil;
static AVAudioEngine* audioEngine = nil;
static Napi::ThreadSafeFunction transcriptionCallback;
static bool isListening = false;
static NSString* currentLanguage = @"en-US";

// Forward declarations
void SendTranscriptionUpdate(const std::string& text, bool isFinal);
void CleanupRecognition(void);

// Check if speech recognition is available for a language
Napi::Value IsLanguageAvailable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    NSString* language = @"en-US";
    if (info.Length() > 0 && info[0].IsString()) {
        std::string langStr = info[0].As<Napi::String>().Utf8Value();
        language = [NSString stringWithUTF8String:langStr.c_str()];
    }

    NSLocale* locale = [NSLocale localeWithLocaleIdentifier:language];
    SFSpeechRecognizer* recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];

    bool available = recognizer != nil && [recognizer isAvailable];

    return Napi::Boolean::New(env, available);
}

// Check current permission status
Napi::Value CheckPermissions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);

    // Check speech recognition permission
    SFSpeechRecognizerAuthorizationStatus speechStatus = [SFSpeechRecognizer authorizationStatus];
    bool speechGranted = (speechStatus == SFSpeechRecognizerAuthorizationStatusAuthorized);
    result.Set("speech", Napi::Boolean::New(env, speechGranted));
    result.Set("speechStatus", Napi::String::New(env,
        speechStatus == SFSpeechRecognizerAuthorizationStatusAuthorized ? "authorized" :
        speechStatus == SFSpeechRecognizerAuthorizationStatusDenied ? "denied" :
        speechStatus == SFSpeechRecognizerAuthorizationStatusRestricted ? "restricted" : "notDetermined"));

    // Check microphone permission
    AVAuthorizationStatus micStatus = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    bool micGranted = (micStatus == AVAuthorizationStatusAuthorized);
    result.Set("microphone", Napi::Boolean::New(env, micGranted));
    result.Set("microphoneStatus", Napi::String::New(env,
        micStatus == AVAuthorizationStatusAuthorized ? "authorized" :
        micStatus == AVAuthorizationStatusDenied ? "denied" :
        micStatus == AVAuthorizationStatusRestricted ? "restricted" : "notDetermined"));

    return result;
}

// Request permissions (triggers system dialogs, returns immediately)
Napi::Value RequestPermissions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Request speech recognition permission first
    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
        NSLog(@"🎤 Speech recognition authorization: %d", (int)status);

        // Then request microphone permission
        [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
            NSLog(@"🎤 Microphone authorization: %d", (int)granted);
        }];
    }];

    // Return true immediately - caller should poll CheckPermissions after a delay
    return Napi::Boolean::New(env, true);
}

// Start listening for speech
Napi::Value StartListening(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (isListening) {
        return Napi::String::New(env, "Already listening");
    }

    // Get language parameter
    if (info.Length() > 0 && info[0].IsString()) {
        std::string langStr = info[0].As<Napi::String>().Utf8Value();
        currentLanguage = [NSString stringWithUTF8String:langStr.c_str()];
    }

    // Get callback function for transcription updates
    if (info.Length() > 1 && info[1].IsFunction()) {
        transcriptionCallback = Napi::ThreadSafeFunction::New(
            env,
            info[1].As<Napi::Function>(),
            "TranscriptionCallback",
            0,
            1
        );
    }

    // Check permissions first
    SFSpeechRecognizerAuthorizationStatus authStatus = [SFSpeechRecognizer authorizationStatus];
    if (authStatus != SFSpeechRecognizerAuthorizationStatusAuthorized) {
        return Napi::String::New(env, "Speech recognition not authorized");
    }

    AVAuthorizationStatus micStatus = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    if (micStatus != AVAuthorizationStatusAuthorized) {
        return Napi::String::New(env, "Microphone not authorized");
    }

    // Initialize speech recognizer with locale
    NSLocale* locale = [NSLocale localeWithLocaleIdentifier:currentLanguage];
    speechRecognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];

    if (!speechRecognizer || ![speechRecognizer isAvailable]) {
        NSString* msg = [NSString stringWithFormat:@"Speech recognizer not available for %@", currentLanguage];
        return Napi::String::New(env, [msg UTF8String]);
    }

    // Initialize audio engine
    audioEngine = [[AVAudioEngine alloc] init];

    // Create recognition request
    recognitionRequest = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
    recognitionRequest.shouldReportPartialResults = YES;

    // Configure audio session
    AVAudioInputNode* inputNode = [audioEngine inputNode];
    AVAudioFormat* recordingFormat = [inputNode outputFormatForBus:0];

    // Install tap on input node
    [inputNode installTapOnBus:0
                    bufferSize:1024
                        format:recordingFormat
                         block:^(AVAudioPCMBuffer* buffer, AVAudioTime* when) {
        if (recognitionRequest) {
            [recognitionRequest appendAudioPCMBuffer:buffer];
        }
    }];

    // Prepare and start audio engine
    NSError* error = nil;
    [audioEngine prepare];
    if (![audioEngine startAndReturnError:&error]) {
        NSLog(@"❌ Audio engine failed to start: %@", error);
        CleanupRecognition();
        return Napi::String::New(env, "Audio engine failed to start");
    }

    // Start recognition task
    recognitionTask = [speechRecognizer recognitionTaskWithRequest:recognitionRequest
        resultHandler:^(SFSpeechRecognitionResult* result, NSError* error) {
            if (error) {
                NSLog(@"❌ Recognition error: %@", error);
                if (isListening) {
                    SendTranscriptionUpdate("", true);
                }
                return;
            }

            if (result) {
                NSString* transcription = result.bestTranscription.formattedString;
                bool isFinal = result.isFinal;

                NSLog(@"🎤 Transcription%@: %@", isFinal ? @" (final)" : @"", transcription);
                SendTranscriptionUpdate([transcription UTF8String], isFinal);

                if (isFinal) {
                    CleanupRecognition();
                }
            }
        }];

    isListening = true;
    NSLog(@"✅ Started listening with language: %@", currentLanguage);

    return Napi::String::New(env, "ok");
}

// Stop listening and return final transcription
Napi::Value StopListening(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!isListening) {
        return Napi::String::New(env, "Not listening");
    }

    NSLog(@"🛑 Stopping speech recognition");

    // End the recognition request to get final result
    if (recognitionRequest) {
        [recognitionRequest endAudio];
    }

    // Stop audio engine
    if (audioEngine && [audioEngine isRunning]) {
        [audioEngine stop];
        [[audioEngine inputNode] removeTapOnBus:0];
    }

    isListening = false;

    return Napi::String::New(env, "ok");
}

// Get current listening status
Napi::Value IsListening(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, isListening);
}

// Helper to send transcription updates to JavaScript
void SendTranscriptionUpdate(const std::string& text, bool isFinal) {
    if (transcriptionCallback) {
        auto callback = [text, isFinal](Napi::Env env, Napi::Function jsCallback) {
            Napi::Object result = Napi::Object::New(env);
            result.Set("text", Napi::String::New(env, text));
            result.Set("isFinal", Napi::Boolean::New(env, isFinal));
            jsCallback.Call({result});
        };

        transcriptionCallback.NonBlockingCall(callback);

        if (isFinal) {
            transcriptionCallback.Release();
        }
    }
}

// Cleanup recognition resources
void CleanupRecognition() {
    if (recognitionTask) {
        [recognitionTask cancel];
        recognitionTask = nil;
    }

    if (audioEngine) {
        if ([audioEngine isRunning]) {
            [audioEngine stop];
        }
        @try {
            [[audioEngine inputNode] removeTapOnBus:0];
        } @catch (NSException* e) {
            // Tap may already be removed
        }
        audioEngine = nil;
    }

    recognitionRequest = nil;
    speechRecognizer = nil;
    isListening = false;
}

// Get list of supported languages
Napi::Value GetSupportedLanguages(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    NSSet<NSLocale*>* locales = [SFSpeechRecognizer supportedLocales];
    Napi::Array result = Napi::Array::New(env, [locales count]);

    __block uint32_t index = 0;
    for (NSLocale* locale in locales) {
        NSString* identifier = [locale localeIdentifier];
        result.Set(index++, Napi::String::New(env, [identifier UTF8String]));
    }

    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "isLanguageAvailable"),
                Napi::Function::New(env, IsLanguageAvailable));
    exports.Set(Napi::String::New(env, "checkPermissions"),
                Napi::Function::New(env, CheckPermissions));
    exports.Set(Napi::String::New(env, "requestPermissions"),
                Napi::Function::New(env, RequestPermissions));
    exports.Set(Napi::String::New(env, "startListening"),
                Napi::Function::New(env, StartListening));
    exports.Set(Napi::String::New(env, "stopListening"),
                Napi::Function::New(env, StopListening));
    exports.Set(Napi::String::New(env, "isListening"),
                Napi::Function::New(env, IsListening));
    exports.Set(Napi::String::New(env, "getSupportedLanguages"),
                Napi::Function::New(env, GetSupportedLanguages));
    return exports;
}

NODE_API_MODULE(speech_recognition, Init)

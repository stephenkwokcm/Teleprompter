{
  "targets": [
    {
      "target_name": "window_protection",
      "sources": [ "window_protection.mm" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.10",
        "OTHER_CFLAGS": [
          "-ObjC++"
        ]
      },
      "conditions": [
        ["OS=='mac'", {
          "sources": [ "window_protection.mm" ],
          "link_settings": {
            "libraries": [
              "-framework Cocoa",
              "-framework AppKit"
            ]
          }
        }]
      ]
    },
    {
      "target_name": "speech_recognition",
      "sources": [ "speech_recognition.mm" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.15",
        "OTHER_CFLAGS": [
          "-ObjC++"
        ]
      },
      "conditions": [
        ["OS=='mac'", {
          "sources": [ "speech_recognition.mm" ],
          "link_settings": {
            "libraries": [
              "-framework Foundation",
              "-framework Speech",
              "-framework AVFoundation"
            ]
          }
        }]
      ]
    }
  ]
}
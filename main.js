const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

console.log('🚀 Starting Teleprompter App...');

let mainWindow;
let windowProtection;
let speechRecognition;

// Load window protection native module
try {
  windowProtection = require('./native/build/Release/window_protection.node');
  console.log('✅ Window protection module loaded');
} catch (error) {
  console.error('❌ Failed to load window protection module:', error.message);
  console.log('⚠️  Running without screen capture protection');
}

// Load speech recognition native module
try {
  speechRecognition = require('./native/build/Release/speech_recognition.node');
  console.log('✅ Speech recognition module loaded');
} catch (error) {
  console.error('❌ Failed to load speech recognition module:', error.message);
  console.log('⚠️  Voice Q&A feature will not be available');
}

function createWindow() {
  console.log('📱 Creating main window...');

  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    type: 'panel',
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  console.log('📄 Loading index.html...');
  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    console.log('✅ Window ready to show');
    mainWindow.show();
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  if (windowProtection) {
    try {
      const buffer = mainWindow.getNativeWindowHandle();
      windowProtection.setWindowProtection(buffer);
      console.log('✅ Window protection applied');
    } catch (error) {
      console.error('❌ Failed to apply window protection:', error);
    }
  }

  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Get the data file path
function getDataPath() {
  return path.join(app.getPath('userData'), 'scripts.json');
}

// Save scripts to disk
async function saveScripts(scripts) {
  try {
    await fs.writeFile(getDataPath(), JSON.stringify(scripts, null, 2));
    console.log('✅ Scripts saved successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to save scripts:', error);
    return false;
  }
}

// Load scripts from disk
async function loadScripts() {
  try {
    const data = await fs.readFile(getDataPath(), 'utf8');
    console.log('✅ Scripts loaded successfully');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('📝 No existing scripts found, starting fresh');
      return {};
    }
    console.error('❌ Failed to load scripts:', error);
    return {};
  }
}

ipcMain.on('close-window', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('save-scripts', async (event, scripts) => {
  return await saveScripts(scripts);
});

ipcMain.handle('load-scripts', async () => {
  return await loadScripts();
});

// ============================================
// Voice Q&A: Speech Recognition IPC Handlers
// ============================================

ipcMain.handle('qa-check-permissions', async () => {
  if (!speechRecognition) {
    return { speech: false, microphone: false, error: 'Speech module not loaded' };
  }
  return speechRecognition.checkPermissions();
});

ipcMain.handle('qa-request-permissions', async () => {
  if (!speechRecognition) {
    return { error: 'Speech module not loaded' };
  }
  return speechRecognition.requestPermissions();
});

ipcMain.handle('qa-is-language-available', async (event, language) => {
  if (!speechRecognition) {
    return false;
  }
  return speechRecognition.isLanguageAvailable(language);
});

ipcMain.handle('qa-get-supported-languages', async () => {
  if (!speechRecognition) {
    return [];
  }
  return speechRecognition.getSupportedLanguages();
});

ipcMain.handle('qa-start-listening', async (event, language) => {
  if (!speechRecognition) {
    return { error: 'Speech module not loaded' };
  }

  const result = speechRecognition.startListening(language || 'en-US', (update) => {
    // Send transcription updates to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('qa-transcription-update', update);
    }
  });

  if (result === 'ok') {
    console.log('🎤 Started listening for speech');
    return { success: true };
  } else {
    console.error('❌ Failed to start listening:', result);
    return { error: result };
  }
});

ipcMain.handle('qa-stop-listening', async () => {
  if (!speechRecognition) {
    return { error: 'Speech module not loaded' };
  }

  const result = speechRecognition.stopListening();
  console.log('🛑 Stopped listening');
  return { success: result === 'ok' };
});

ipcMain.handle('qa-is-listening', async () => {
  if (!speechRecognition) {
    return false;
  }
  return speechRecognition.isListening();
});

// ============================================
// Voice Q&A: Ollama Integration
// ============================================

const OLLAMA_BASE_URL = 'http://localhost:11434';

async function ollamaFetch(endpoint, options = {}) {
  const url = `${OLLAMA_BASE_URL}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    return response;
  } catch (error) {
    console.error('❌ Ollama fetch error:', error.message);
    throw error;
  }
}

ipcMain.handle('qa-check-ollama', async () => {
  try {
    const response = await ollamaFetch('/api/tags');
    if (response.ok) {
      const data = await response.json();
      const models = data.models ? data.models.map(m => m.name) : [];
      console.log('✅ Ollama is running, models:', models);
      return { running: true, models };
    }
    return { running: false, models: [], error: 'Ollama not responding' };
  } catch (error) {
    return { running: false, models: [], error: error.message };
  }
});

ipcMain.handle('qa-list-models', async () => {
  try {
    const response = await ollamaFetch('/api/tags');
    if (response.ok) {
      const data = await response.json();
      return data.models ? data.models.map(m => m.name) : [];
    }
    return [];
  } catch (error) {
    console.error('❌ Failed to list Ollama models:', error.message);
    return [];
  }
});

ipcMain.handle('qa-get-suggestions', async (event, question, context, model) => {
  const selectedModel = model || 'llama3.2:1b';

  const systemPrompt = `You are a presentation assistant helping a presenter answer audience questions during a live presentation. Given a question, provide exactly 3 brief, helpful response options.

Rules:
- Each response should be 2-3 sentences maximum
- Be professional and confident
- Be direct and actionable
- Respond ONLY with a valid JSON array of exactly 3 strings
- No markdown, no explanations, just the JSON array`;

  const userPrompt = context
    ? `Question from audience: "${question}"\n\nContext (current slide topic): "${context}"`
    : `Question from audience: "${question}"`;

  try {
    console.log('🤖 Requesting suggestions from Ollama...');

    const response = await ollamaFetch('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        model: selectedModel,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 500
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Ollama error:', errorText);
      return { error: `Ollama error: ${response.status}` };
    }

    const data = await response.json();
    const responseText = data.response || '';

    console.log('🤖 Ollama response:', responseText);

    // Try to parse as JSON array
    try {
      // Find JSON array in response (in case there's extra text)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        if (Array.isArray(suggestions) && suggestions.length > 0) {
          return { suggestions: suggestions.slice(0, 3) };
        }
      }

      // Fallback: split by newlines if not valid JSON
      const lines = responseText.split('\n').filter(l => l.trim().length > 0);
      if (lines.length > 0) {
        return { suggestions: lines.slice(0, 3) };
      }

      return { error: 'Could not parse suggestions' };
    } catch (parseError) {
      console.error('❌ Failed to parse Ollama response:', parseError.message);
      // Return raw response as single suggestion
      return { suggestions: [responseText.trim()] };
    }
  } catch (error) {
    console.error('❌ Ollama request failed:', error.message);
    return { error: error.message };
  }
});

// Get/set Q&A settings
function getQASettingsPath() {
  return path.join(app.getPath('userData'), 'qa-settings.json');
}

ipcMain.handle('qa-get-settings', async () => {
  try {
    const data = await fs.readFile(getQASettingsPath(), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Return defaults
    return {
      language: 'en-US',
      model: 'llama3.2:1b'
    };
  }
});

ipcMain.handle('qa-save-settings', async (event, settings) => {
  try {
    await fs.writeFile(getQASettingsPath(), JSON.stringify(settings, null, 2));
    return { success: true };
  } catch (error) {
    console.error('❌ Failed to save Q&A settings:', error);
    return { error: error.message };
  }
});
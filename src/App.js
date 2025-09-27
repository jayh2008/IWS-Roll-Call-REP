import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, browserLocalPersistence } from 'firebase/auth'; 
import { getFirestore, doc, setDoc, onSnapshot, collection, query, serverTimestamp, getDocs, deleteDoc } from 'firebase/firestore'; 
import { RefreshCw, Camera, List, CheckCircle, XCircle, Upload, Settings, Zap, AlertCircle } from 'lucide-react'; 

// Load the HTML5-QR-Code library for scanning via CDN script.
const Html5QrcodeScannerScript = () => (
  <script src="https://unpkg.com/html5-qrcode@2.3.4/dist/html5-qrcode.min.js"></script>
);

// --- 1. FIREBASE SETUP & AUTH HOOK ---

// Define the Firebase Configuration manually for the Android build
// Credentials provided by the user
const FIREBASE_PROJECT_CONFIG = {
  apiKey: "AIzaSyAtZsHh1GXRCvN-5SJZYkdpNY4lkzrxE8w",
  authDomain: "iws-roll-call-app.firebaseapp.com",
  projectId: "iws-roll-call-app",
  storageBucket: "iws-roll-call-app.firebasestorage.app",
  appId: "1:731256484801:web:d0aac7e31e634d71267540"
};

// Static configuration settings for the native Android app
const APP_IDENTIFIER = "rollcallmanager"; 
const firebaseConfig = FIREBASE_PROJECT_CONFIG;

// The main collection path for public, shared data.
const ROSTER_COLLECTION_PATH = `artifacts/${APP_IDENTIFIER}/public/data/rollCallRoster`;

/**
 * Custom hook for initializing Firebase and handling authentication.
 * Manages the connection, auth state, and user ID.
 */
const useFirebaseAuth = () => {
  const [authData, setAuthData] = useState({
    db: null,
    auth: null,
    userId: null,
    isAuthReady: false,
    initError: null,
  });

  useEffect(() => {
    // Dynamically import enablePersistence inside the hook where it's used
    let enablePersistence;
    try {
        ({ enablePersistence } = require('firebase/firestore'));
    } catch (e) {
        console.warn("Could not import enablePersistence locally.");
    }
    
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      console.error("Firebase config is incomplete. Check FIREBASE_PROJECT_CONFIG.");
      setAuthData(prev => ({ ...prev, isAuthReady: true, initError: "Incomplete Firebase Config." })); 
      return; 
    }

    let authInstance;
    let dbInstance;
    let unsubscribeAuth;
    
    const initializeFirebase = async () => {
        try {
            const app = initializeApp(firebaseConfig);
            dbInstance = getFirestore(app);
            authInstance = getAuth(app);
            
            // Forced browserLocalPersistence
            try {
                await authInstance._setPersistence(browserLocalPersistence);
                console.log("Auth Persistence set to browserLocalPersistence (Native compatible).");
            } catch (err) {
                console.warn("Could not set browserLocalPersistence:", err);
            }

            // 1. Enable Persistence (Offline Mode)
            if (enablePersistence) {
                try {
                    await enablePersistence(dbInstance);
                    console.log("Firestore persistence enabled for offline use.");
                } catch (err) {
                    if (err.code === 'failed-precondition') {
                        console.warn("Persistence failure: already running or multiple instances.");
                    } else if (err.code === 'unimplemented') {
                        console.warn("Persistence failure: Environment does not support IndexedDB.");
                    } else {
                        console.error("Firestore persistence failed:", err);
                    }
                }
            } else {
                console.warn("Offline persistence feature skipped due to module import failure.");
            }

            // 2. Perform Anonymous Sign-In
            try {
                await signInAnonymously(authInstance);
            } catch (authError) {
                console.error("Firebase Auth Sign-in Error:", authError);
                if (authError.code === 'auth/operation-not-allowed') {
                    setAuthData(prev => ({ ...prev, initError: "Anonymous Auth must be enabled in Firebase Console." }));
                } else {
                    setAuthData(prev => ({ ...prev, initError: `Auth Error: ${authError.message}` }));
                }
            }
            
            // 3. Set up Auth State Listener 
            unsubscribeAuth = onAuthStateChanged(authInstance, (user) => {
                const userId = user?.uid || crypto.randomUUID();
                setAuthData(prev => ({
                    ...prev,
                    db: dbInstance,
                    auth: authInstance,
                    userId,
                    isAuthReady: true,
                }));
                console.log(`User ID initialized: ${userId}`);
            });

        } catch (e) {
            console.error("Critical Firebase Initialization Failure:", e);
            setAuthData(prev => ({ ...prev, isAuthReady: true, initError: `Initialization Failed: ${e.message}` }));
        }
    };

    initializeFirebase();

    // Cleanup function
    return () => {
        if (unsubscribeAuth) {
            unsubscribeAuth();
        }
    };
  }, []);

  return authData;
};

/**
 * Utility function to retry a promise-returning function with exponential backoff.
 */
const retryOperation = async (operation, maxRetries = 5, delay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (error.code === 'permission-denied' || error.code === 'unavailable' || i === maxRetries - 1) {
        if (i === maxRetries - 1) {
          console.error(`Operation failed after ${maxRetries} attempts:`, error);
          throw error;
        }
        const backoff = delay * Math.pow(2, i);
        console.warn(`Attempt ${i + 1} failed. Retrying database operation in ${backoff}ms...`); 
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        throw error;
      }
    }
  }
};


// --- 2. DATA MANAGEMENT (ROSTER AND SEEDING) ---

const INITIAL_ROSTER = [
  { id: 'RC-1001', name: 'Alfie Johnson' },
  { id: 'RC-1002', name: 'Brenda Chen' },
  { id: 'RC-1003', name: 'Charlie Davis' },
  { id: 'RC-1004', name: 'Diana Evans' },
  { id: 'RC-0000', name: 'Error Test Person' },
  { id: 'RC-1005', name: 'Ethan Foster' },
];

const seedRoster = async (db) => {
  if (!db) return;
  
  try {
    await retryOperation(async () => {
      const rosterRef = collection(db, ROSTER_COLLECTION_PATH);
      const snapshot = await getDocs(query(rosterRef));

      if (snapshot.empty) {
        console.log("Seeding initial roster...");
        for (const person of INITIAL_ROSTER) {
          await setDoc(doc(db, ROSTER_COLLECTION_PATH, person.id), {
            id: person.id,
            name: person.name,
            status: 'absent',
            lastScan: null,
            createdAt: serverTimestamp(),
          });
        }
        console.log("Roster seeding complete.");
      }
    });
  } catch (e) {
    console.error("Critical error during roster seeding:", e);
  }
};

// --- 3. COMPONENTS (CONSOLIDATED) ---

// 3.1 Roster Display Component
const RosterDisplay = ({ roster, db, isAuthReady, onStatusToggle }) => {
  const [isManaging, setIsManaging] = useState(false);
  const [newRosterText, setNewRosterText] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const fileInputRef = useRef(null);

  const sortedRoster = [...roster].sort((a, b) => {
    if (a.status === 'present' && b.status !== 'present') return -1;
    if (a.status !== 'present' && b.status === 'present') return 1;
    return a.name.localeCompare(b.name);
  });

  const presentCount = roster.filter(p => p.status === 'present').length;
  const totalCount = roster.length;

  const parseRosterData = (text) => {
    const lines = text.trim().split('\n');
    const rosterData = [];
    let errorCount = 0;

    for (const line of lines) {
        // 🚨 FIX: Remove extra commas at the end (common in Excel CSV exports)
        let parts = line.split(',');
        
        // Trim leading and trailing whitespace from all parts
        parts = parts.map(p => p.trim());
        
        // Filter out empty parts at the end caused by trailing commas
        while (parts.length > 2 && parts[parts.length - 1] === '') {
            parts.pop();
        }

        // We only care about the first two columns (ID and Name)
        if (parts.length >= 2 && parts[0] && parts[1]) {
            let id = parts[0];
            let name = parts[1];
            
            // 🚨 FIX: Clean up leading numbers (e.g., "1.Dean Owens" -> "Dean Owens")
            name = name.replace(/^(\d+\.?\s?)/, '').trim(); 
            
            rosterData.push({ id: id, name: name });
        } else if (line.trim() !== '') {
            errorCount++;
        }
    }
    return { rosterData, errorCount };
  };

  const executeRosterUpload = async (dataToUpload, errorCount) => {
    if (!db) return;

    if (dataToUpload.length === 0) {
        setUploadMessage('Error: No valid entries found. Format: ID, Name (one per line).');
        setTimeout(() => setUploadMessage(''), 5000);
        return;
    }

    const confirmMessage = `Ready to replace the entire roster with ${dataToUpload.length} entries. Continue? (Existing attendance will be lost)`;
    const isConfirmed = window.confirm(confirmMessage);
    if (!isConfirmed) return;

    try {
        setUploadMessage('Processing...');
        const rosterRef = collection(db, ROSTER_COLLECTION_PATH);

        // 1. Delete existing roster
        const existingSnapshot = await getDocs(query(rosterRef));
        const batchDelete = existingSnapshot.docs.map(d => deleteDoc(doc(db, ROSTER_COLLECTION_PATH, d.id)));
        await retryOperation(() => Promise.all(batchDelete), 3, 500); 

        // 2. Upload new roster
        const batchUpload = dataToUpload.map(person => {
            const personDocRef = doc(db, ROSTER_COLLECTION_PATH, person.id);
            return setDoc(personDocRef, {
                id: person.id,
                name: person.name,
                status: 'absent',
                lastScan: null,
                createdAt: serverTimestamp(),
            });
        });
        await retryOperation(() => Promise.all(batchUpload), 3, 500); 

        setUploadMessage(`Successfully uploaded ${dataToUpload.length} members. ${errorCount} invalid lines skipped.`);
        setNewRosterText('');
        if (fileInputRef.current) fileInputRef.current.value = ''; // Reset file input
    } catch (error) {
        console.error("Error during roster upload:", error);
        setUploadMessage('Critical Error during upload. Check console for details.');
    }
    
    setTimeout(() => setUploadMessage(''), 5000);
  };

  const handleTextUpload = () => {
    const { rosterData, errorCount } = parseRosterData(newRosterText);
    executeRosterUpload(rosterData, errorCount);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
        setUploadMessage('Error: Please select a CSV (.csv) file.');
        setTimeout(() => setUploadMessage(''), 5000);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
        const fileContent = e.target.result;
        const { rosterData, errorCount } = parseRosterData(fileContent);
        executeRosterUpload(rosterData, errorCount);
    };

    reader.onerror = () => {
        setUploadMessage('Error reading file.');
        setTimeout(() => setUploadMessage(''), 5000);
    };

    reader.readAsText(file);
  };

  const handleReset = async () => {
    if (!db) return;

    const isConfirmed = window.confirm("Are you sure you want to reset attendance for ALL? This cannot be undone.");
    if (!isConfirmed) return;

    const updates = sortedRoster.map(person => {
      const personDocRef = doc(db, ROSTER_COLLECTION_PATH, person.id);
      return setDoc(personDocRef, { status: 'absent', lastScan: null }, { merge: true });
    });

    try {
      await retryOperation(() => Promise.all(updates), 3, 500); 
      console.log("Attendance reset successful.");
    } catch (error) {
      console.error("Error resetting attendance:", error);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <h2 className="text-3xl font-extrabold text-gray-800 border-b pb-2">
        Roll Call Status
      </h2>

      <div className="bg-white p-4 rounded-xl shadow-lg flex justify-between items-center flex-wrap gap-4">
        <p className="text-xl font-semibold text-gray-700">
          Attendance: <span className="text-sky-600">{presentCount} / {totalCount}</span>
        </p>
        <div className="flex space-x-2">
            <button
              onClick={() => setIsManaging(!isManaging)}
              className="flex items-center space-x-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300"
              disabled={!isAuthReady}
            >
              <List size={18} />
              <span>{isManaging ? 'Hide Manager' : 'Manage Roster'}</span>
            </button>
            <button
              onClick={handleReset}
              disabled={!isAuthReady || totalCount === 0}
              className="flex items-center space-x-2 bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 disabled:opacity-50"
            >
              <RefreshCw size={18} />
              <span>Reset Roll Call</span>
            </button>
        </div>
      </div>
      
      {/* Roster Management Form */}
      {isManaging && (
          <div className="bg-white p-4 rounded-xl shadow-xl border border-sky-200 space-y-4">
              <h3 className="text-xl font-bold text-sky-700 mb-2">Roster Management</h3>
              
              <div className="border p-3 rounded-lg bg-gray-50 space-y-3">
                  <p className="text-md font-semibold text-gray-700 flex items-center">
                      <Upload size={18} className="mr-2 text-cyan-500" /> Upload via CSV File
                  </p>
                  <p className="text-sm text-gray-600">
                      Export your Excel or Google Sheet as a **CSV file** where the first column is the **UNIQUE\_ID** and the second column is the **Full Name**.
                  </p>
                  <input
                      type="file"
                      ref={fileInputRef}
                      accept=".csv"
                      onChange={handleFileUpload}
                      className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100"
                      disabled={!isAuthReady}
                  />
              </div>

              <div className="border p-3 rounded-lg bg-gray-50 space-y-3">
                  <p className="text-md font-semibold text-gray-700">Paste Text Manually</p>
                  <p className="text-sm text-gray-600">
                      Paste your list below. Each entry should be on a new line, formatted as: 
                      <code className="bg-gray-100 p-1 rounded-md text-sm font-mono block mt-1">UNIQUE_ID, Full Name</code>
                  </p>
                  <textarea
                      className="w-full p-3 border border-gray-300 rounded-lg font-mono text-sm resize-none focus:ring-sky-500 focus:border-sky-500" 
                      rows="6"
                      placeholder="Example:&#10;P001, John Doe&#10;P002, Jane Smith&#10;P003, Alice Johnson"
                      value={newRosterText}
                      onChange={(e) => setNewRosterText(e.target.value)}
                      disabled={!isAuthReady}
                  />
                  <button
                      onClick={handleTextUpload}
                      disabled={!isAuthReady || !newRosterText.trim()}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition duration-300 disabled:opacity-50"
                  >
                      Upload & Replace Roster (from text)
                  </button>
              </div>

              {uploadMessage && (
                  <p className={`text-center font-semibold text-sm ${uploadMessage.startsWith('Error') ? 'text-red-600' : 'text-sky-600'}`}>{uploadMessage}</p> 
              )}
              <p className="text-xs text-red-500 pt-2">Warning: Uploading a new roster will **delete all existing attendees** and their current attendance status.</p>
          </div>
      )}
      
      <p className="text-sm text-gray-500 bg-yellow-50 p-3 rounded-lg border border-yellow-200">
        *To create a scannable QR code, encode the "QR Value (ID)" for each person using an online QR generator.
      </p>

      <div className="overflow-x-auto bg-white rounded-xl shadow-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                QR Value (ID)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                Last Scan
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedRoster.map((person) => (
              <tr 
                key={person.id} 
                className={person.status === 'present' ? 'bg-green-50 hover:bg-green-100 cursor-pointer' : 'hover:bg-gray-50 cursor-pointer'}
                onClick={() => isAuthReady && onStatusToggle(person)} // <-- Manual click handler
              >
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  {person.status === 'present' ? (
                    <div className="flex items-center text-green-600">
                      <CheckCircle size={20} className="mr-2" />
                      Present
                    </div>
                  ) : (
                    <div className="flex items-center text-red-500">
                      <XCircle size={20} className="mr-2" />
                      Absent
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                  {person.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-sky-600 font-mono"> {/* Updated color */}
                  {person.id}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden sm:table-cell">
                  {person.lastScan ? new Date(person.lastScan.toMillis()).toLocaleTimeString() : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// 3.2 Enhanced Scanner Component
const ScannerStatus = {
    INITIALIZING: 'Initializing...',
    ACTIVE: 'Scanning Active',
    PROCESSING: 'Processing Scan...',
    ERROR: 'Error',
};

const EnhancedScannerView = ({ handleScanSuccess }) => {
  const scannerRef = useRef(null);
  const html5QrCodeRef = useRef(null);
  const retryTimeoutRef = useRef(null);
    
  const [scannerState, setScannerState] = useState({
    isInitializing: true,
    isRunning: false,
    isPaused: false,
    hasPermission: null,
    error: null,
    lastScanTime: null,
    scanCount: 0,
    flashOn: false
  });
    
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [showCameraSelector, setShowCameraSelector] = useState(false);

  const scannerConfig = {
    fps: 10,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const minEdgePercentage = 0.75;
      const minEdgeSize = Math.min(viewfinderWidth, viewfinderHeight);
      const qrboxSize = Math.floor(minEdgeSize * minEdgePercentage);
      return {
        width: qrboxSize,
        height: qrboxSize
      };
    },
    disableFlip: false,
    aspectRatio: 1.0,
    supportedScanTypes: [0],
  };

  const stopScanner = useCallback(() => {
    if (html5QrCodeRef.current && scannerState.isRunning) {
      if (html5QrCodeRef.current.isScanning) {
          html5QrCodeRef.current.stop().then(() => {
              setScannerState(prev => ({
                ...prev, 
                isRunning: false, 
                isInitializing: false,
                isPaused: false,
                flashOn: false,
              }));
          }).catch(err => {
              console.log('Error stopping previous scanner:', err);
          });
      }
    }
  }, [scannerState.isRunning]);

  const detectCameras = useCallback(async () => {
    try {
      if (typeof window.Html5Qrcode === 'undefined') {
        throw new Error('QR Code library not loaded');
      }
      const availableCameras = await window.Html5Qrcode.getCameras();
      console.log('Available cameras:', availableCameras);
      if (availableCameras.length === 0) {
        throw new Error('No cameras found on device');
      }
      setCameras(availableCameras);
      
      let preferredCameraId;
      const backCamera = availableCameras.find(camera => 
          camera.label && (
           camera.label.toLowerCase().includes('back') || 
           camera.label.toLowerCase().includes('environment') ||
           camera.label.toLowerCase().includes('rear')
         )
      );
      
      if (backCamera) {
        preferredCameraId = backCamera.id;
        console.log('Selected back camera:', backCamera.label);
      } else if (availableCameras.length > 1) {
        preferredCameraId = availableCameras[1].id;
      } else {
        preferredCameraId = availableCameras[0].id;
      }
      
      setSelectedCameraId(preferredCameraId);
      return preferredCameraId;
    } catch (error) {
      console.error('Camera detection failed:', error);
      throw error;
    }
  }, []);

  const initializeScanner = useCallback(async (cameraId = null) => {
    // 1. **ALL LOGIC MUST BE HERE**
    stopScanner(); // Ensure previous instance is stopped

    try {
        setScannerState(prev => ({
            ...prev,
            isInitializing: true,
            error: null,
            isRunning: false,
        }));

        let targetCameraId = cameraId || selectedCameraId;
        if (!targetCameraId) {
            // This is Line 608 from the previous log
            targetCameraId = await detectCameras(); 
        }

        const html5Qrcode = new window.Html5Qrcode(
            scannerRef.current.id,
            { verbose: false }
        );
        // ... rest of the scanner setup logic (onScanSuccess, html5Qrcode.start, etc.)

    } catch (error) {
        // ... error handling
    }
}, [/* all dependencies, including scannerConfig */]);

      const onScanSuccess = (decodedText) => {
        const now = Date.now();
        if (scannerState.lastScanTime && now - scannerState.lastScanTime < 2000) {
          console.log('Ignoring duplicate scan');
          return;
        }

        setScannerState(prev => ({
          ...prev,
          lastScanTime: now,
          scanCount: prev.scanCount + 1,
          isPaused: true
        }));
        
        handleScanSuccess(decodedText);

            setTimeout(() => {
        if (html5QrCodeRef.current) {
            try {
                html5QrCodeRef.current.resume();
                setScannerState(prev => ({
                    ...prev,
                    isPaused: false
                }));
            } catch (resumeError) {
                console.error('Error resuming scanner:', resumeError);
            }
        }
}, 3000);} 

await html5Qrcode.start(
    // ADD targetCameraId back here as the first parameter:
    targetCameraId, 
    scannerConfig,
    onScanSuccess,
    // ... rest of the parameters ...
        (errorMessage) => {
            if (errorMessage.includes('NotAllowedError') || 
                errorMessage.includes('Permission denied') ||
                errorMessage.includes('NotFoundError')) {
                // Critical error, stop scanner and flag permission issue
                stopScanner(); 
                setScannerState(prev => ({
                    ...prev,
                    error: 'Camera access denied. Please grant permissions.',
                    hasPermission: false,
                    isInitializing: false,
                }));
            }
        }
      );
      
      html5QrCodeRef.current = html5Qrcode;
      setScannerState(prev => ({
        ...prev,
        isInitializing: false,
        isRunning: true,
        hasPermission: true,
        error: null
      }));
      console.log('Scanner initialized successfully');
    } catch (error) {
      console.error("Scanner initialization failed:", error);
      stopScanner();
      
      let errorMessage = 'Failed to start camera';
      let hasPermission = null;
      if (error.name === "NotAllowedError" || error.message?.includes("Permission denied")) {
        errorMessage = "Camera access denied. Please grant camera permissions using the Settings button.";
        hasPermission = false;
      } else if (error.name === "NotFoundError") {
        errorMessage = "No camera found on this device.";
      }
      
      setScannerState(prev => ({
        ...prev,
        isInitializing: false,
        isRunning: false,
        hasPermission,
        error: errorMessage
      }));
    }
  }, [handleScanSuccess, selectedCameraId, detectCameras, stopScanner, scannerState.lastScanTime]);

  // Handle initialization on mount and cleanup on unmount
  useEffect(() => {
    // Wait for the library script to load before attempting to initialize
    const checkAndInit = () => {
        if (typeof window.Html5Qrcode !== 'undefined') { 
            initializeScanner();
        } else {
            retryTimeoutRef.current = setTimeout(checkAndInit, 500);
        }
    };
    
    checkAndInit();

    return () => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
        }
        stopScanner();
    };
  }, [initializeScanner, stopScanner]); 
  
  // Camera controls
  const switchCamera = useCallback((cameraId) => {
    setSelectedCameraId(cameraId);
    setShowCameraSelector(false);
    initializeScanner(cameraId);
  }, [initializeScanner]);
  
  const toggleFlash = useCallback(async () => {
    if (!html5QrCodeRef.current || !scannerState.isRunning) return;

    try {
        const canControlTorch = await html5QrCodeRef.current.isTorchSupported();
        if (canControlTorch) {
            await html5QrCodeRef.current.setTorchEnabled(!scannerState.flashOn);
            setScannerState(prev => ({
              ...prev,
              flashOn: !prev.flashOn
            }));
        } else {
            setScannerState(prev => ({
              ...prev,
              error: 'Flash/Torch functionality not supported by this camera.'
            }));
        }
    } catch (error) {
        console.error("Flash toggle failed:", error);
    }
  }, [scannerState.isRunning, scannerState.flashOn]);


  const renderStatusIndicator = () => {
    if (scannerState.isInitializing) {
      return (
        <div className="absolute top-4 left-4 bg-yellow-500/90 text-white px-3 py-1 rounded-full text-sm font-semibold flex items-center z-20">
          <RefreshCw size={14} className="animate-spin mr-2" />
          {ScannerStatus.INITIALIZING}
        </div>
      );
    }
    if (scannerState.isRunning && !scannerState.isPaused) {
      return (
        <div className="absolute top-4 left-4 bg-green-500/90 text-white px-3 py-1 rounded-full text-sm font-semibold flex items-center z-20">
          <CheckCircle size={14} className="mr-2" />
          {ScannerStatus.ACTIVE}
        </div>
      );
    }
    if (scannerState.isPaused) {
      return (
        <div className="absolute top-4 left-4 bg-blue-500/90 text-white px-3 py-1 rounded-full text-sm font-semibold flex items-center z-20">
          <AlertCircle size={14} className="mr-2" />
          {ScannerStatus.PROCESSING}
        </div>
      );
    }
    if (scannerState.error) {
        return (
            <div className="absolute top-4 left-4 bg-red-500/90 text-white px-3 py-1 rounded-full text-sm font-semibold flex items-center z-20">
                <XCircle size={14} className="mr-2" />
                {ScannerStatus.ERROR}
            </div>
        );
    }
    return null;
  };
  
  return (
    <div className="p-4 md:p-8 space-y-6 bg-gray-900 min-h-screen text-white">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-extrabold text-white flex items-center justify-center">
          <Camera className="mr-2 text-cyan-400" size={30} />
          Enhanced Attendance Scanner
        </h2>
        <p className="text-gray-200">Point your camera at the QR code to mark attendance</p>
        {scannerState.scanCount > 0 && (
          <p className="text-cyan-400 text-sm">
            Scans processed: {scannerState.scanCount}
          </p>
        )}
      </div>
      
      {/* Scanner Viewport */}
      <div className="bg-black p-1 rounded-xl shadow-2xl relative">
        {renderStatusIndicator()}
        
        {/* Camera Selector Overlay */}
        {showCameraSelector && cameras.length > 1 && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-8 z-30 rounded-xl">
                <div className="bg-gray-800 rounded-lg p-4 space-y-3 w-full max-w-sm">
                    <p className="text-white text-lg font-semibold border-b border-gray-600 pb-2">Select Camera</p>
                    {cameras.map((camera, index) => (
                        <button
                            key={camera.id}
                            onClick={() => switchCamera(camera.id)}
                            className={`block w-full text-left text-sm p-3 rounded transition ${
                              camera.id === selectedCameraId
                                ? 'bg-sky-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                        >
                            {camera.label || `Camera ${index + 1}`}
                        </button>
                    ))}
                    <button
                        onClick={() => setShowCameraSelector(false)}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg mt-2"
                    >
                        Close
                    </button>
                </div>
            </div>
        )}

        <div className="absolute bottom-4 right-4 flex space-x-2 z-20">
          {cameras.length > 1 && (
            <button
              onClick={() => setShowCameraSelector(!showCameraSelector)}
              className="bg-gray-700/90 hover:bg-gray-600/90 text-white p-2 rounded-full transition-colors"
              title="Switch Camera"
            >
              <Settings size={20} />
            </button>
          )}
          <button
            onClick={toggleFlash}
            disabled={!scannerState.isRunning}
            className={`p-2 rounded-full transition duration-150 ${scannerState.flashOn ? 'bg-yellow-400 text-gray-900' : 'bg-gray-700 text-white hover:bg-gray-600'} disabled:opacity-50`}
            title="Toggle Flash"
          >
            {scannerState.flashOn ? <Zap size={20} /> : <Zap size={20} />}
          </button>
        </div>
        
        <div 
           id="enhanced-scanner-container" 
           ref={scannerRef} 
           className="w-full mx-auto aspect-video max-w-lg rounded-lg overflow-hidden"
        >
          {scannerState.isInitializing && !scannerState.error && (
            <div className="flex items-center justify-center h-full bg-gray-700 text-gray-300 min-h-[300px]">
              <div className="text-center space-y-3">
                <RefreshCw size={32} className="animate-spin mx-auto" />
                <p>Starting camera...</p>
              </div>
            </div>
          )}
          {!scannerState.isRunning && !scannerState.isInitializing && !scannerState.error && (
            <div className="flex items-center justify-center h-full bg-gray-700 text-gray-300 min-h-[300px]">
              <div className="text-center space-y-3">
                <Camera size={32} className="mx-auto" />
                <p>Camera ready to scan</p>
              </div>
            </div>
          )}
          {/* Fallback space */}
          <div id={'scanner-container-enhanced'} />
        </div>
      </div>
      
      {/* Error Feedback */}
      {scannerState.error && (
        <div className="bg-red-900/90 border border-red-700 rounded-lg p-4 space-y-4">
          <div className="flex items-center text-red-400">
            <AlertCircle size={20} className="mr-2 flex-shrink-0" />
            <p className="font-semibold">Scanner Error</p>
          </div>
                    
          <p className="text-red-200">{scannerState.error}</p>
          
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => initializeScanner()}
              className="bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center"
            >
              <RefreshCw size={16} className="mr-2" />
              Retry Camera
            </button>
            
            {scannerState.hasPermission === false && (
              <button
                onClick={() => window.location.reload()}
                className="bg-yellow-700 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
              >
                Reload App (Try Re-prompt)
              </button>
            )}
          </div>
          
          {scannerState.hasPermission === false && (
            <div className="bg-yellow-900/50 border border-yellow-700 rounded p-3 mt-3">
              <p className="text-yellow-200 text-sm">
                <strong>Permission Help:</strong> Use the **Settings button** (gear icon) in the header to navigate to the Permissions Manager screen and manually request access.
              </p>
            </div>
          )}
        </div>
      )}
      
      <div className="bg-gray-800/50 rounded-lg p-4 text-center">
        <p className="text-gray-300 text-sm">
          Hold your phone steady and align the QR code within the scanning area. 
          The scanner will automatically detect and process valid codes.
        </p>
      </div>
    </div>
  );
};

// --- PERMISSIONS MANAGER COMPONENT ---

const useAlertMessage = () => {
    const [message, setMessage] = useState({ text: '', type: 'info' });
    const setCustomMessage = useCallback((text, type = 'info') => {
        setMessage({ text, type });
        setTimeout(() => setMessage({ text: '', type: 'info' }), 5000);
    }, []);
    return [message, setCustomMessage];
};

const PermissionsManager = () => {
  const [cameraStatus, setCameraStatus] = useState('unknown');
  const [storageStatus, setStorageStatus] = useState('unknown');
  const [statusMessage, setStatusMessage] = useAlertMessage();
  
  // Use a ref to check if the global Capacitor object is available
  const isCapacitorAvailable = typeof window.Capacitor !== 'undefined' && window.Capacitor.isPluginAvailable('Camera');
  
  // Maps Capacitor status strings to CSS classes
  const getButtonClass = (status) => {
    if (status === 'granted') return 'bg-green-600 hover:bg-green-700';
    if (status === 'denied' || status === 'never_ask_again') return 'bg-red-600 hover:bg-red-700';
    return 'bg-yellow-600 hover:bg-yellow-700';
  };

  // Function to get current status
  const checkStatus = useCallback(async () => {
    if (!isCapacitorAvailable) return;

    try {
        const { Camera, Filesystem } = window.Capacitor.Plugins; // Declared here
        
        // Camera Permission Check
        const cameraPerms = await Camera.checkPermissions();
        setCameraStatus(cameraPerms.camera || 'unknown');

        // Storage Permission Check
        const storagePerms = await Filesystem.checkPermissions();
        setStorageStatus(storagePerms.publicStorage || 'unknown'); 

    } catch (e) {
        console.error("Capacitor Plugin check failed:", e);
        setStatusMessage("Native plugin access failed. Ensure the app is correctly synced and permissions are in AndroidManifest.xml.", 'error');
    }
  }, [isCapacitorAvailable, setStatusMessage]);
  
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Function to request permission
  const requestPermission = async (permissionType) => {
    if (!isCapacitorAvailable) {
        setStatusMessage("Capacitor plugins not available. Are you running this as a built APK?", 'error');
        return;
    }
    
    try {
        let result;
        const { Camera, Filesystem } = window.Capacitor.Plugins; // Redundant declaration removed
        
        if (permissionType === 'camera') {
            result = await Camera.requestPermissions();
            setStatusMessage(`Camera permission status: ${result.camera.toUpperCase()}`, result.camera === 'granted' ? 'success' : 'warning');
        } else if (permissionType === 'storage') {
            result = await Filesystem.requestPermissions();
            setStatusMessage(`Storage permission status: ${result.publicStorage.toUpperCase()}`, result.publicStorage === 'granted' ? 'success' : 'warning');
        }

        await checkStatus();

    } catch (e) {
        console.error("Permission request failed:", e);
        setStatusMessage("Error requesting permission. Status may be blocked by OS.", 'error');
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-8 bg-gray-100 min-h-screen">
      <h2 className="text-3xl font-extrabold text-sky-900 border-b pb-2">
        Native Permissions Manager
      </h2>
      <p className="text-gray-600">
        If the app features are not working, use these buttons to manually trigger the required Android permission prompts.
      </p>

      <div className="space-y-4">
        {/* Camera Permission Button */}
        <div className="flex items-center justify-between p-4 bg-white rounded-xl shadow-md border">
          <p className="font-semibold">Camera Access (Scanning)</p>
          <button
            onClick={() => requestPermission('camera')}
            disabled={cameraStatus === 'granted' || cameraStatus === 'never_ask_again'}
            className={`text-white font-bold py-3 px-6 rounded-lg transition duration-300 disabled:opacity-50 ${getButtonClass(cameraStatus)}`}
          >
            {cameraStatus === 'granted' ? 'GRANTED' : (cameraStatus === 'denied' ? 'DENIED' : 'REQUEST CAMERA')}
          </button>
        </div>

        {/* Storage Permission Button */}
        <div className="flex items-center justify-between p-4 bg-white rounded-xl shadow-md border">
          <p className="font-semibold">Storage Access (CSV Upload)</p>
          <button
            onClick={() => requestPermission('storage')}
            disabled={storageStatus === 'granted' || storageStatus === 'never_ask_again'}
            className={`text-white font-bold py-3 px-6 rounded-lg transition duration-300 disabled:opacity-50 ${getButtonClass(storageStatus)}`}
          >
            {storageStatus === 'granted' ? 'GRANTED' : (storageStatus === 'denied' ? 'DENIED' : 'REQUEST STORAGE')}
          </button>
        </div>

        {statusMessage.text && (
            <p className={`text-center font-semibold text-sm p-2 rounded ${statusMessage.type === 'error' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                {statusMessage.text}
            </p>
        )}
        
        <div className="text-sm text-gray-500 pt-4">
          Status Legend: GRANTED (Green) - DENIED (Red) - PROMPT/UNKNOWN (Yellow)
        </div>
      </div>
    </div>
  );
};


// --- 4. MAIN APP COMPONENT ---

const App = () => {
  const { db, userId, isAuthReady, initError } = useFirebaseAuth();
  const [roster, setRoster] = useState([]);
  const [activeView, setActiveView] = useState('display'); // 'display', 'scanner', or 'permissions'
  const [scanMessage, setScanMessage] = useState({ text: '', type: 'info' });

  // 4a. Load Data and Seed Roster
  useEffect(() => {
    if (!db || !isAuthReady) return;

    // Seeding is now wrapped with retry logic
    seedRoster(db); 

    const rosterRef = collection(db, ROSTER_COLLECTION_PATH);
    const rosterQuery = query(rosterRef);
    let unsubscribe;
    
    // FIX: Introduce a small delay before establishing the real-time listener
    const listenerTimeout = setTimeout(() => {
        unsubscribe = onSnapshot(rosterQuery, (snapshot) => {
          const updatedRoster = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id,
          }));
          setRoster(updatedRoster);
          console.log("Roster updated:", updatedRoster.length, "records.");
        }, (error) => {
          // Log only persistent errors
          if (error.code !== 'permission-denied') {
             console.error("Firestore Listener Error:", error);
          } else {
             // If a transient permission error occurs, the listener is allowed to fail
             console.warn("Firestore Listener hit transient permission error. Waiting for auth resolution.");
          }
        });
    }, 300); // 300ms delay

    return () => {
        clearTimeout(listenerTimeout);
        if (unsubscribe) {
            unsubscribe();
        }
    };
  }, [db, isAuthReady]);

  // 4b. Handle Scan Event
  const handleScanSuccess = useCallback(async (scannedId) => {
    if (!db) {
      setScanMessage({ text: "Database not ready.", type: 'error' });
      return;
    }

    const person = roster.find(p => p.id === scannedId);

    if (!person) {
      console.warn(`Scanned ID '${scannedId}' not found in roster.`);
      setScanMessage({
        text: `Error: QR Code ID "${scannedId}" does not match any attendee.`,
        type: 'error',
      });
      return;
    }

    // Determine new status
    const newStatus = person.status === 'present' ? 'absent' : 'present';
    const messageAction = newStatus === 'present' ? 'PRESENT' : 'ABSENT';

    // Update the document in Firestore, wrapped in retry logic
    const personDocRef = doc(db, ROSTER_COLLECTION_PATH, scannedId);
    try {
      await retryOperation(() => setDoc(personDocRef, {
        status: newStatus,
        lastScan: serverTimestamp(),
      }, { merge: true }), 3, 500);

      setScanMessage({
        text: `Success! ${person.name} is now marked as ${messageAction}.`,
        type: 'success',
      });

      console.log(`Successfully marked ${person.name} as ${messageAction}.`);

    } catch (error) {
      console.error("Error updating document:", error);
      setScanMessage({
        text: `Failed to update attendance for ${person.name}.`,
        type: 'error',
      });
    }

    // Clear message after 5 seconds
    setTimeout(() => setScanMessage({ text: '', type: 'info' }), 5000);

  }, [db, roster]);

  // 4c. Manual Status Toggle
  const handleManualStatusToggle = useCallback(async (person) => {
    if (!db) return;

    // Determine new status
    const newStatus = person.status === 'present' ? 'absent' : 'present';
    const messageAction = newStatus === 'present' ? 'PRESENT' : 'ABSENT';

    // Update the document in Firestore, wrapped in retry logic
    const personDocRef = doc(db, ROSTER_COLLECTION_PATH, person.id);
    try {
      await retryOperation(() => setDoc(personDocRef, {
        status: newStatus,
        lastScan: serverTimestamp(),
      }, { merge: true }), 3, 500);

      setScanMessage({
        text: `Manual update: ${person.name} toggled to ${messageAction}.`,
        type: 'warning',
      });

      console.log(`Manually toggled ${person.name} to ${messageAction}.`);

    } catch (error) {
      console.error("Error updating document:", error);
      setScanMessage({
        text: `Failed to update attendance manually for ${person.name}.`,
        type: 'error',
      });
    }

    // Clear message after 5 seconds
    setTimeout(() => setScanMessage({ text: '', type: 'info' }), 5000);

  }, [db]);


  // 4d. Rendering
  const getMessageStyle = () => {
    switch (scanMessage.type) {
      case 'success':
        return 'bg-green-500/90 text-white';
      case 'error':
        return 'bg-red-500/90 text-white';
      case 'warning':
        return 'bg-yellow-500/90 text-white';
      default:
        return 'bg-sky-500/90 text-white'; // Updated color
    }
  };

  return (
    <div className="min-h-screen font-sans">
      <Html5QrcodeScannerScript />

      {/* Header and Navigation */}
      <header className="bg-sky-900 shadow-md p-4 pt-10 sticky top-0 z-10"> {/* INCREASED pt-10 for robust padding */}
        <div className="flex justify-between items-center max-w-4xl mx-auto">
          <h1 className="text-xl md:text-2xl font-bold text-white">IWS Roll Call Manager</h1>
          <div className="flex space-x-2">
            <button
              onClick={() => setActiveView('display')}
              className={`p-3 rounded-full transition duration-300 ${activeView === 'display' ? 'bg-white text-sky-700 shadow-lg' : 'bg-sky-700 text-white hover:bg-sky-800'}`} // Updated colors
              title="View Roster"
            >
              <List size={24} />
            </button>
            <button
              onClick={() => setActiveView('scanner')}
              className={`p-3 rounded-full transition duration-300 ${activeView === 'scanner' ? 'bg-white text-sky-700 shadow-lg' : 'bg-sky-700 text-white hover:bg-sky-800'}`} // Updated colors
              title="Start Scanner"
            >
              <Camera size={24} />
            </button>
            {/* NEW PERMISSIONS BUTTON */}
            <button
              onClick={() => setActiveView('permissions')}
              className={`p-3 rounded-full transition duration-300 ${activeView === 'permissions' ? 'bg-white text-sky-700 shadow-lg' : 'bg-sky-700 text-white hover:bg-sky-800'}`} // Updated colors
              title="Permission Settings"
            >
              <Settings size={24} />
            </button>
          </div>
        </div>
      </header>

      {/* Scan Message Alert */}
      {scanMessage.text && (
        <div
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 p-4 rounded-xl shadow-2xl transition-all duration-300 z-50 text-center font-semibold max-w-xs w-full ${getMessageStyle()}`}
          role="alert"
        >
          {scanMessage.text}
        </div>
      )}

      {/* Main Content Area */}
      <main className={`max-w-4xl mx-auto ${activeView === 'scanner' ? 'bg-gray-900 min-h-screen' : 'bg-gray-100'}`}>
        {/* Initialization Error/Loading */}
        {!isAuthReady && !initError && (
          <div className="text-center p-12 text-xl font-semibold text-gray-500">
            Initializing application and cloud connection...
          </div>
        )}
        
        {initError && (
            <div className="bg-red-100 p-6 rounded-lg border border-red-400 m-8 text-red-800">
                <h3 className="text-xl font-bold mb-3">🚨 Initialization Failed</h3>
                <div className="space-y-2 text-sm">
                    <p>The application could not connect to Firebase. This usually happens in the native environment if the configuration is incomplete or authentication is blocked.</p>
                    <p>Error: <strong>{initError}</strong></p>
                    <p className='font-semibold pt-2'>Troubleshooting Steps:</p>
                    <ul className='list-disc list-inside ml-4'>
                        <li>Check the **`google-services.json`** file is in the **`android/app`** folder.</li>
                        <li>Verify **Anonymous Sign-in** is **Enabled** in your Firebase Console.</li>
                        <li>In Android Studio, click **File &gt; Sync Project with Gradle Files**.</li>
                    </ul>
                </div>
            </div>
        )}

        {isAuthReady && !initError && activeView === 'display' && (
          <RosterDisplay roster={roster} db={db} isAuthReady={isAuthReady} onStatusToggle={handleManualStatusToggle} />
        )}

        {isAuthReady && !initError && activeView === 'scanner' && (
          <EnhancedScannerView handleScanSuccess={handleScanSuccess} />
        )}
        
        {/* NEW PERMISSIONS VIEW RENDER */}
        {isAuthReady && !initError && activeView === 'permissions' && (
          <PermissionsManager />
        )}
      </main>

      {/* Footer / Debug Info */}
      <footer className="p-2 text-center text-xs text-gray-500 bg-gray-200">
        <p>App ID: {APP_IDENTIFIER}</p>
        <p>Current User ID: {userId}</p>
      </footer>
    </div>
  );
};

export default App;









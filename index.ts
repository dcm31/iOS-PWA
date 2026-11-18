import { Hono } from "npm:hono";
import webpush from "npm:web-push@3.6.7";

const app = new Hono();

// Initialize VAPID keys
async function getVapidKeys() {
  const { blob } = await import("https://esm.town/v/std/blob");
  
  let keys = await blob.getJSON("vapid-keys-v2");
  
  if (!keys) {
    console.log("Generating new VAPID keys...");
    const vapidKeys = webpush.generateVAPIDKeys();
    keys = {
      publicKey: vapidKeys.publicKey,
      privateKey: vapidKeys.privateKey
    };
    await blob.setJSON("vapid-keys-v2", keys);
    console.log("VAPID keys generated and saved");
  }
  
  return keys;
}

app.get("/", (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="apple-mobile-web-app-capable" content="yes">
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
      <title>iOS Push Notify</title>
      <link rel="manifest" href="/manifest.json">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .container {
          background: white;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 {
          margin-top: 0;
          color: #333;
        }
        button {
          background: #007AFF;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
          width: 100%;
          margin: 10px 0;
        }
        button:hover {
          background: #0051D5;
        }
        button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        .status {
          margin: 15px 0;
          padding: 12px;
          border-radius: 8px;
          background: #f0f0f0;
        }
        .success {
          background: #d4edda;
          color: #155724;
        }
        .error {
          background: #f8d7da;
          color: #721c24;
        }
        .info {
          background: #d1ecf1;
          color: #0c5460;
        }
        .install-prompt {
          background: #fff3cd;
          color: #856404;
          padding: 16px;
          border-radius: 8px;
          margin: 20px 0;
        }
        input {
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 16px;
          margin: 10px 0;
          box-sizing: border-box;
        }
        #debug {
          margin-top: 20px;
          padding: 10px;
          background: #f8f9fa;
          border-radius: 4px;
          font-size: 12px;
          font-family: monospace;
          max-height: 200px;
          overflow-y: auto;
        }
        .note {
          background: #e7f3ff;
          border-left: 4px solid #007AFF;
          padding: 12px;
          margin: 15px 0;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔔 iOS Push Notifications</h1>
        
        <div id="install-prompt" class="install-prompt" style="display: none;">
          <strong>📱 Installation Required</strong><br>
          To receive push notifications on iOS, you must:
          <ol>
            <li>Tap the Share button</li>
            <li>Select "Add to Home Screen"</li>
            <li>Return to this app from your home screen</li>
          </ol>
        </div>
        
        <div class="note">
          <strong>💡 Testing Tips:</strong><br>
          • Notifications work even when app is open<br>
          • Close app to see lock screen notification<br>
          • Check notification center if you miss it
        </div>
        
        <div id="status" class="status">Loading...</div>
        
        <button id="enable-btn" disabled>Enable Notifications</button>
        
        <div style="margin-top: 20px;">
          <input type="text" id="message-input" placeholder="Enter test message" value="Test from iOS!" />
          <button id="send-btn" disabled>Send Test Notification</button>
        </div>
        
        <div id="debug"></div>
      </div>

      <script>
        let subscriptionId = null;
        const statusDiv = document.getElementById('status');
        const installPrompt = document.getElementById('install-prompt');
        const enableBtn = document.getElementById('enable-btn');
        const sendBtn = document.getElementById('send-btn');
        const messageInput = document.getElementById('message-input');
        const debugDiv = document.getElementById('debug');

        function log(msg) {
          console.log(msg);
          debugDiv.innerHTML += msg + '<br>';
          debugDiv.scrollTop = debugDiv.scrollHeight;
        }

        const isInstalled = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
        
        function updateStatus(message, type = 'info') {
          statusDiv.textContent = message;
          statusDiv.className = 'status ' + type;
          log('Status: ' + message);
        }

        log('App started. isInstalled: ' + isInstalled);

        if (!('serviceWorker' in navigator)) {
          updateStatus('Service workers not supported in this browser', 'error');
        } else if (!('PushManager' in window)) {
          updateStatus('Push notifications not supported in this browser', 'error');
        } else if (!isInstalled) {
          installPrompt.style.display = 'block';
          updateStatus('Please install this app to Home Screen first', 'info');
        } else {
          updateStatus('Ready to enable notifications', 'success');
          enableBtn.disabled = false;
        }

        if ('serviceWorker' in navigator && isInstalled) {
          log('Registering service worker...');
          navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
              log('✓ Service Worker registered');
              console.log('Service Worker registered:', registration);
            })
            .catch(error => {
              log('✗ Service Worker failed: ' + error.message);
              console.error('Service Worker registration failed:', error);
            });
        }

        enableBtn.addEventListener('click', async () => {
          log('Enable button clicked');
          try {
            log('Requesting permission...');
            const permission = await Notification.requestPermission();
            log('Permission: ' + permission);
            
            if (permission !== 'granted') {
              updateStatus('Notification permission denied', 'error');
              return;
            }

            log('Getting service worker...');
            const registration = await navigator.serviceWorker.ready;
            log('✓ Service worker ready');
            
            log('Fetching VAPID key...');
            const vapidResponse = await fetch('/api/vapid-public-key');
            const vapidData = await vapidResponse.json();
            log('✓ VAPID key: ' + vapidData.publicKey.substring(0, 20) + '...');

            log('Subscribing to push...');
            const subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey)
            });
            log('✓ Push subscription created');

            log('Saving to server...');
            const response = await fetch('/api/subscribe', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(subscription)
            });

            const data = await response.json();
            subscriptionId = data.subscriptionId;
            log('✓ Saved! ID: ' + subscriptionId.substring(0, 8));
            
            updateStatus('✓ Notifications enabled!', 'success');
            enableBtn.disabled = true;
            sendBtn.disabled = false;

            localStorage.setItem('subscriptionId', subscriptionId);

          } catch (error) {
            log('✗ ERROR: ' + error.message);
            console.error('Error:', error);
            updateStatus('Error: ' + error.message, 'error');
          }
        });

        sendBtn.addEventListener('click', async () => {
          const message = messageInput.value || 'Hello from Val Town!';
          log('Sending: "' + message + '"');
          
          try {
            const subId = subscriptionId || localStorage.getItem('subscriptionId');
            log('Using subscription: ' + subId.substring(0, 8));
            
            const response = await fetch('/api/send-notification', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                subscriptionId: subId,
                message: message
              })
            });

            const data = await response.json();
            log('Response: ' + JSON.stringify(data));
            
            if (data.success) {
              updateStatus('✓ Notification sent! Check your device.', 'success');
              log('✓ Check lock screen or notification center');
            } else {
              updateStatus('Failed: ' + (data.error || 'Unknown'), 'error');
            }
          } catch (error) {
            log('✗ Send error: ' + error.message);
            updateStatus('Error: ' + error.message, 'error');
          }
        });

        if (isInstalled && localStorage.getItem('subscriptionId')) {
          subscriptionId = localStorage.getItem('subscriptionId');
          enableBtn.disabled = true;
          sendBtn.disabled = false;
          updateStatus('Already subscribed!', 'success');
          log('Using saved subscription: ' + subscriptionId.substring(0, 8));
        }

        function urlBase64ToUint8Array(base64String) {
          const padding = '='.repeat((4 - base64String.length % 4) % 4);
          const base64 = (base64String + padding)
            .replace(/\\-/g, '+')
            .replace(/_/g, '/');

          const rawData = atob(base64);
          const outputArray = new Uint8Array(rawData.length);

          for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
          }
          return outputArray;
        }
      </script>
    </body>
    </html>
  `;
  return c.html(html);
});

app.get("/manifest.json", (c) => {
  return c.json({
    name: "iOS Push Notify",
    short_name: "Push Notify",
    description: "iOS PWA with Web Push notifications",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#007AFF",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  });
});

app.get("/service-worker.js", (c) => {
  const swCode = `
self.addEventListener('install', (event) => {
  console.log('SW: Install');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('SW: Activate');
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  console.log('SW: Push received', event);
  
  let data = {
    title: 'New Notification',
    body: 'You have a new message',
    icon: '/icon-192.png'
  };

  if (event.data) {
    try {
      data = event.data.json();
      console.log('SW: Push data:', data);
    } catch (e) {
      data.body = event.data.text();
      console.log('SW: Push text:', data.body);
    }
  }

  console.log('SW: Showing notification:', data);

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.icon,
      vibrate: [200, 100, 200],
      tag: 'push-notification',
      requireInteraction: false
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('SW: Notification clicked');
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});
`;
  
  return new Response(swCode, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/'
    }
  });
});

app.get("/icon-:size.png", (c) => {
  return new Response("🔔", {
    headers: { "Content-Type": "text/plain" }
  });
});

app.get("/api/vapid-public-key", async (c) => {
  const keys = await getVapidKeys();
  return c.json({ publicKey: keys.publicKey });
});

app.post("/api/subscribe", async (c) => {
  try {
    const { blob } = await import("https://esm.town/v/std/blob");
    const subscription = await c.req.json();
    
    console.log("New subscription received");
    
    const subscriptionId = crypto.randomUUID();
    await blob.setJSON("subscription-" + subscriptionId, subscription);
    
    console.log("Subscription saved:", subscriptionId);
    
    return c.json({ success: true, subscriptionId });
  } catch (error) {
    console.error("Subscribe error:", error);
    return c.json({ error: error.message }, 500);
  }
});

app.post("/api/send-notification", async (c) => {
  try {
    const { blob } = await import("https://esm.town/v/std/blob");
    const { message, subscriptionId } = await c.req.json();
    
    console.log("Send notification request:", { message, subscriptionId: subscriptionId?.substring(0, 8) });
    
    if (!subscriptionId) {
      return c.json({ error: "subscriptionId required" }, 400);
    }
    
    const subscription = await blob.getJSON("subscription-" + subscriptionId);
    
    if (!subscription) {
      console.log("Subscription not found:", subscriptionId);
      return c.json({ error: "Subscription not found" }, 404);
    }
    
    console.log("Found subscription, endpoint:", subscription.endpoint.substring(0, 50) + "...");
    
    // Get VAPID keys
    const keys = await getVapidKeys();
    
    // Configure web-push
    webpush.setVapidDetails(
      'mailto:push@valtown.email',
      keys.publicKey,
      keys.privateKey
    );
    
    const payload = JSON.stringify({
      title: "Test Notification",
      body: message || "Hello from Val Town!",
      icon: "/icon-192.png"
    });
    
    console.log("Sending push with payload:", payload);
    
    // Send notification using web-push library
    const result = await webpush.sendNotification(subscription, payload);
    
    console.log("Push sent successfully! Status:", result.statusCode);
    
    return c.json({ 
      success: true, 
      message: "Notification sent successfully!",
      status: result.statusCode
    });
    
  } catch (error) {
    console.error("Push error:", error);
    console.error("Error details:", error.body || error.message);
    return c.json({ 
      error: error.message,
      details: error.body || "Unknown error"
    }, 500);
  }
});

export default app.fetch;

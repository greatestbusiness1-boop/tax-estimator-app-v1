/**
 * Unified Client Core System
 * Single source of truth for ALL leads, estimates, transcripts, payments
 */

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "leads.json");

// Load all clients
function getAllClients() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw || "[]");
}

// Save all clients
function saveAllClients(clients) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2));
}

// Get or create unified client
function getOrCreateClient(leadId, baseData = {}) {
  const clients = getAllClients();

  let client = clients.find(c => c.clientId === leadId);

  if (!client) {
    client = {
      clientId: leadId,
      name: baseData.name || "",
      email: baseData.email || "",

      estimate: null,

      transcript: {
        status: "none",
        form8821: "not sent",
        identityVerified: false,
        yearsRequested: []
      },

      payments: {
        estimateReviewPaid: false,
        transcriptPaid: false,
        stripeSessionId: null
      },

      lifecycle: {
        stage: "lead",
        lastUpdated: new Date().toISOString()
      }
    };

    clients.push(client);
    saveAllClients(clients);
  }

  return client;
}

// Update client
function updateClient(leadId, updates = {}) {
  const clients = getAllClients();

  const index = clients.findIndex(c => c.clientId === leadId);
  if (index === -1) return null;

  clients[index] = {
    ...clients[index],
    ...updates,
    lifecycle: {
      ...clients[index].lifecycle,
      lastUpdated: new Date().toISOString()
    }
  };

  saveAllClients(clients);
  return clients[index];
}

module.exports = {
  getAllClients,
  getOrCreateClient,
  updateClient
};

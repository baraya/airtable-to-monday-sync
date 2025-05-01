// sync.js
require('dotenv').config(); // Load local .env variables

const fs = require('fs');
const axios = require('axios');
const path = require('path');

const airtableToken = process.env.AIRTABLE_PAT;
const airtableBaseId = process.env.AIRTABLE_BASE_ID;
const airtableTable = process.env.AIRTABLE_TABLE_NAME;
const mondayApiKey = process.env.MONDAY_API_KEY;
const mondayBoardId = process.env.MONDAY_BOARD_ID;

if (!airtableToken || !airtableBaseId || !airtableTable || !mondayApiKey || !mondayBoardId) {
  console.error("❌ Missing one or more required environment variables.");
  process.exit(1);
}

const cachePath = path.resolve(__dirname, 'synced.json');
let syncedIds = new Set();

function loadSyncedIds() {
  if (fs.existsSync(cachePath)) {
    try {
      const data = fs.readFileSync(cachePath, 'utf8');
      const ids = JSON.parse(data);
      syncedIds = new Set(ids);
      console.log(`Loaded ${syncedIds.size} synced IDs`);
    } catch (err) {
      console.error('Failed to parse synced.json:', err.message);
      process.exit(1);
    }
  } else {
    console.log('No existing synced.json found, starting fresh');
  }
}

function saveSyncedIds() {
  const list = Array.from(syncedIds);
  fs.writeFileSync(cachePath, JSON.stringify(list, null, 2));
  console.log(`Saved ${list.length} synced IDs to synced.json`);
}

async function fetchAirtableRecords() {
  const url = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableTable)}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${airtableToken}`,
    },
  });
  return response.data.records;
}

async function createMondayItem(name) {
  const query = `
    mutation {
      create_item (board_id: ${mondayBoardId}, item_name: "${name}") {
        id
      }
    }
  `;

  const response = await axios.post(
    'https://api.monday.com/v2',
    { query },
    {
      headers: {
        Authorization: mondayApiKey,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data?.data?.create_item?.id;
}

(async () => {
  try {
    loadSyncedIds();
    const records = await fetchAirtableRecords();

    let syncedThisRun = 0;

    for (const record of records) {
      const { id, fields } = record;
      const taskName = fields['Task Name'];

      if (!taskName || syncedIds.has(id)) {
        continue;
      }

      console.log(`Syncing: ${taskName}`);
      const mondayId = await createMondayItem(taskName);
      if (mondayId) {
        syncedIds.add(id);
        syncedThisRun++;
        console.log(`✅ Synced and recorded: ${taskName} → Monday ID ${mondayId}`);
      }
    }

    saveSyncedIds();
    console.log(`🎉 Sync complete. ${syncedThisRun} new tasks created.`);
  } catch (err) {
    console.error('❌ Sync failed:', err.message);
    process.exit(1);
  }
})();

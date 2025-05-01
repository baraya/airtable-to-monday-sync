require('dotenv').config(); // Load local .env if running locally

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

// Map Airtable status values to Monday.com status labels
const statusMap = {
  'To Do': 'To Do',
  'In Progress': 'Working on it',
  'Done': 'Done',
  'In QA': 'QA' // only include if QA exists in your Monday board
};

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

async function createMondayItem(itemName, mappedStatus) {
  const columnValues = mappedStatus
    ? JSON.stringify({ status: { label: mappedStatus } })
    : null;

  const query = `
    mutation {
      create_item (
        board_id: ${mondayBoardId},
        item_name: ${JSON.stringify(itemName)}${
          columnValues ? `, column_values: ${JSON.stringify(columnValues)}` : ''
        }
      ) {
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

      if (syncedIds.has(id)) continue;

      const task = fields['Task'];
      if (!task) continue;

      const airtableStatus = fields['Status']?.name || fields['Status'];
      const mappedStatus = statusMap[airtableStatus] || null;

      console.log(`Creating item: "${task}"${mappedStatus ? ` with status "${mappedStatus}"` : ''}`);

      const mondayId = await createMondayItem(task, mappedStatus);

      if (mondayId) {
        syncedIds.add(id);
        syncedThisRun++;
        console.log(`✅ Created Monday.com item ID ${mondayId}`);
      }
    }

    saveSyncedIds();
    console.log(`🎉 Sync complete. ${syncedThisRun} new tasks created.`);
  } catch (err) {
    console.error('❌ Sync failed:', err.message);
    process.exit(1);
  }
})();

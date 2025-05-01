require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// === ENV CONFIG ===
const airtableToken = process.env.AIRTABLE_PAT;
const airtableBaseId = process.env.AIRTABLE_BASE_ID;
const airtableTable = process.env.AIRTABLE_TABLE_NAME;

const mondayApiKey = process.env.MONDAY_API_KEY;
const mondayBoardId = process.env.MONDAY_BOARD_ID;
const mondayGroupId = process.env.MONDAY_GROUP_ID;
const mondayStatusColumnId = process.env.MONDAY_STATUS_COLUMN_ID || 'status';
const mondayClientColumnId = process.env.MONDAY_CLIENT_COLUMN_ID || 'dropdown_mkqahzp5';

const cachePath = path.resolve(__dirname, 'synced.json');
let syncedRecords = [];

// === STATUS MAP (Airtable → Monday) ===
const statusMap = {
    'To Do': 'To Do',
    'In Progress': 'Working on it',
    'Completed': 'Done',
    'Canceled': 'Canceled',
    'Working on it': 'Working on it',
  };  

// === CLIENT MAP (Airtable → Monday Dropdown) ===
const clientDropdownMap = {
  '1172 Napoli': 'Napoli',
  "428 Carmelina": 'Carmelina',
  'Carla Ridge': 'Carla Ridge',
  '21ST Street': '21st',
  'Fishbar Holdings': 'FISHBAR'
};

// === Cache Helpers ===
function loadCache() {
  if (fs.existsSync(cachePath)) {
    try {
      syncedRecords = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      console.log(`Loaded ${syncedRecords.length} synced records`);
    } catch (err) {
      console.error('❌ Failed to parse synced.json:', err.message);
      process.exit(1);
    }
  } else {
    console.log('No synced.json found, starting fresh');
  }
}

function saveCache() {
  fs.writeFileSync(cachePath, JSON.stringify(syncedRecords, null, 2));
  console.log(`✅ Saved ${syncedRecords.length} records to synced.json`);
}

// === Airtable ===
async function fetchAirtableRecords() {
  const url = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableTable)}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${airtableToken}`,
    },
  });
  return response.data.records;
}

// === Monday.com ===
async function createMondayItem(itemName, statusLabel, clientLabels) {
  const columnValuesObject = {
    ...(statusLabel && { [mondayStatusColumnId]: { label: statusLabel } }),
    ...(clientLabels.length > 0 && {
      [mondayClientColumnId]: { labels: clientLabels }
    })
  };

  const columnValues = Object.keys(columnValuesObject).length
    ? JSON.stringify(columnValuesObject)
    : null;

  const query = `
    mutation {
      create_item (
        board_id: ${mondayBoardId},
        group_id: ${JSON.stringify(mondayGroupId)},
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

// === Sync Logic ===
(async () => {
  try {
    loadCache();
    const records = await fetchAirtableRecords();

    for (const record of records) {
      const { id: airtableId, fields } = record;
      const task = fields['Task'];
      if (!task) continue;

      // --- Status ---
      const airtableStatus = fields['Status']?.name || fields['Status'];
      const mappedStatus = statusMap[airtableStatus] || null;

      // --- Client Dropdown ---
      const clientNames = fields['Client Name Label'] || [];
      const mappedClientLabels = Array.isArray(clientNames)
        ? clientNames.map(name => clientDropdownMap[name]).filter(Boolean)
        : clientDropdownMap[clientNames]
          ? [clientDropdownMap[clientNames]]
          : [];
      
      
      // --- Skip if already synced ---
      const alreadySynced = syncedRecords.find(r => r.airtable_id === airtableId);
      if (alreadySynced) {
        console.log(`⏩ Skipped "${task}" — already synced`);
        continue;
      }

      // --- Create Item ---
      console.log(`🆕 Creating: "${task}"`);
      const mondayId = await createMondayItem(task, mappedStatus, mappedClientLabels);
      if (mondayId) {
        syncedRecords.push({
          airtable_id: airtableId,
          monday_id: mondayId
        });
        console.log(`✅ Created Monday item ${mondayId}`);
      }
    }

    saveCache();
    console.log('🎉 Sync complete.');
  } catch (err) {
    console.error('❌ Sync failed:', err.message);
    process.exit(1);
  }
})();

require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const airtableToken = process.env.AIRTABLE_PAT;
const airtableBaseId = process.env.AIRTABLE_BASE_ID;
const airtableTable = process.env.AIRTABLE_TABLE_NAME;
const mondayApiKey = process.env.MONDAY_API_KEY;
const mondayBoardId = process.env.MONDAY_BOARD_ID;
const mondayStatusColumnId = process.env.MONDAY_STATUS_COLUMN_ID || 'status'; // use actual ID

const cachePath = path.resolve(__dirname, 'synced.json');
let syncedRecords = [];

const statusMap = {
  'To Do': 'To Do',
  'In Progress': 'Working on it',
  Done: 'Done',
  'In QA': 'QA',
};

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

async function fetchAirtableRecords() {
  const url = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableTable)}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${airtableToken}`,
    },
  });
  return response.data.records;
}

async function createMondayItem(itemName, statusLabel) {
  const groupId = process.env.MONDAY_GROUP_ID;

  const columnValues = statusLabel ? JSON.stringify({ [mondayStatusColumnId]: { label: statusLabel } }) : null;

  const query = `
      mutation {
        create_item (
          board_id: ${mondayBoardId},
          group_id: ${JSON.stringify(groupId)},
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

async function updateMondayStatus(itemId, statusLabel) {
  const query = `
    mutation {
      change_column_value (
        board_id: ${mondayBoardId},
        item_id: ${itemId},
        column_id: ${JSON.stringify(mondayStatusColumnId)},
        value: ${JSON.stringify(JSON.stringify({ label: statusLabel }))}
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

  return response.data?.data?.change_column_value?.id;
}

(async () => {
  try {
    loadCache();
    const records = await fetchAirtableRecords();

    for (const record of records) {
      const { id: airtableId, fields } = record;
      const task = fields['Task'];
      const airtableStatus = fields['Status']?.name || fields['Status'];
      const mappedStatus = statusMap[airtableStatus] || null;

      if (!task) continue;

      const existing = syncedRecords.find((r) => r.airtable_id === airtableId);

      if (!existing) {
        // Create new item
        console.log(`🆕 Creating: "${task}"`);
        const mondayId = await createMondayItem(task, mappedStatus);
        if (mondayId) {
          syncedRecords.push({
            airtable_id: airtableId,
            monday_id: mondayId,
            last_status: mappedStatus,
          });
          console.log(`✅ Created Monday item ${mondayId}`);
        }
      } else {
        // Item already exists — check if status changed
        if (mappedStatus && mappedStatus !== existing.last_status) {
          console.log(`🔁 Updating status of "${task}" to "${mappedStatus}"`);
          await updateMondayStatus(existing.monday_id, mappedStatus);
          existing.last_status = mappedStatus;
          console.log(`✅ Updated Monday item ${existing.monday_id}`);
        } else {
          console.log(`⏩ Skipped "${task}" — no changes`);
        }
      }
    }

    saveCache();
    console.log('🎉 Sync complete.');
  } catch (err) {
    console.error('❌ Sync failed:', err.message);
    process.exit(1);
  }
})();

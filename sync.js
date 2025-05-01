// sync.js
const axios = require('axios');

const airtableApiKey = process.env.AIRTABLE_API_KEY;
const airtableBaseId = process.env.AIRTABLE_BASE_ID;
const airtableTable = process.env.AIRTABLE_TABLE_NAME;
const mondayApiKey = process.env.MONDAY_API_KEY;
const mondayBoardId = process.env.MONDAY_BOARD_ID;

// Airtable config
const airtableUrl = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableTable)}`;

async function fetchAirtableRecords() {
  const response = await axios.get(airtableUrl, {
    headers: {
      Authorization: `Bearer ${airtableApiKey}`,
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

  return response.data;
}

(async () => {
  try {
    const records = await fetchAirtableRecords();

    for (const record of records) {
      const taskName = record.fields['Task Name'];
      if (!taskName) continue;

      console.log(`Creating: ${taskName}`);
      const result = await createMondayItem(taskName);
      console.log(`Created item ID:`, result.data?.create_item?.id);
    }

    console.log('Sync complete.');
  } catch (err) {
    console.error('Error during sync:', err.message);
    process.exit(1);
  }
})();

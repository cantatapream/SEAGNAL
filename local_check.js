const CONFIG = {
    // 로컬 서버 URL
    API_URL: 'http://localhost:3001/api/warnings'
};

async function testApi() {
    try {
        console.log(`📡 Fetching from: ${CONFIG.API_URL}`);
        const response = await fetch(CONFIG.API_URL);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ API Response Success!');
        console.log('Data keys:', Object.keys(data));

        if (data.kma) console.log('KMA Data: (Base64 length)', data.kma.length);
        if (data.afso) console.log('AFSO List Count:', data.afso.list?.length || 0);

    } catch (e) {
        console.error('❌ API Fail:', e.message);
    }
}

testApi();

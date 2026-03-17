const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                let redirectUrl = response.headers.location;
                if (!redirectUrl.startsWith('http')) {
                    const u = new URL(url);
                    redirectUrl = u.protocol + '//' + u.host + redirectUrl;
                }
                downloadFile(redirectUrl, dest).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
};

const fetchContent = (url) => {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
};

const processCssAndFonts = async (cssUrl, cssName) => {
    console.log(`Processing ${cssName}...`);
    let cssContent = await fetchContent(cssUrl);
    const fontMatches = [...cssContent.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)];
    
    for (const match of fontMatches) {
        const fontUrl = match[1];
        const fontFileName = path.basename(new URL(fontUrl).pathname) + '.woff2'; // Simplification
        const localFontPath = path.join(__dirname, 'public/lib/fonts', fontFileName);
        
        if (!fs.existsSync(localFontPath)) {
            console.log(`Downloading font: ${fontFileName}`);
            await downloadFile(fontUrl, localFontPath);
        }
        
        cssContent = cssContent.replace(fontUrl, `../fonts/${fontFileName}`);
    }
    
    fs.writeFileSync(path.join(__dirname, 'public/lib/css', cssName), cssContent);
    console.log(`Saved ${cssName}`);
};

const main = async () => {
    // 1. Tailwind
    console.log('Downloading Tailwind...');
    await downloadFile('https://cdn.tailwindcss.com?plugins=forms,container-queries', path.join(__dirname, 'public/lib/js/tailwindcss.js'));

    // 2. Avatar
    console.log('Downloading Avatar...');
    await downloadFile('https://lh3.googleusercontent.com/aida-public/AB6AXuATkPXqFee547meC-ofdWjXU5mw_oxwZolq_DGgNlXWz18aP_RMcRubRC21-TGBWpfGg0B9TT_rkx8N68LSAV2D-jYlaDAQnypMlwTqEHBLRdnaQrhM9q5rIzQIMfcuzyWeT12YVquX01Tg1MydfpMOA2RFh64yEgAkYhITlnAws4qkdZOwOqSRRSKE0V7UjgsknSylbhoAxHvfpQ_VwwSlUd9sN3TVA7k1GgfCCDQLK6QoNcI7n1l1T7RjQ_paa1WL31PGINTtVQ', path.join(__dirname, 'public/lib/images/user-avatar.jpg'));

    // 3. Fonts
    await processCssAndFonts('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap', 'inter.css');
    await processCssAndFonts('https://fonts.googleapis.com/icon?family=Material+Icons+Outlined', 'material-icons-outlined.css');
    await processCssAndFonts('https://fonts.googleapis.com/icon?family=Material+Icons+Round', 'material-icons-round.css');
    await processCssAndFonts('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap', 'material-symbols-outlined.css');

    console.log('Done!');
};

main().catch(console.error);

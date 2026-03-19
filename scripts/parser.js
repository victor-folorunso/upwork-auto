// parser.js.  parse the structured AI output into usable data objects

// Master parse: extracts all four blocks from the raw AI text
function parseAIOutput(rawText) {
    const result = {
        core30: null,
        employment: [],
        otherExp: [],
        loose1000: null,
        errors: []
    };

    const blockRegex = /\[BLOCK:([A-Z0-9_]+)\]([\s\S]*?)\[\/BLOCK:\1\]/g;
    let match;

    while ((match = blockRegex.exec(rawText)) !== null) {
        const name = match[1];
        const content = match[2].trim();

        if (name === 'CORE_30') result.core30 = content;
        else if (name === 'LOOSE_1000') result.loose1000 = content;
        else if (name === 'EMPLOYMENT') result.employment = parseEmploymentEntries(content, result.errors);
        else if (name === 'OTHER_EXP') result.otherExp = parseOtherExpEntries(content, result.errors);
    }

    if (!result.core30 && !result.employment.length &&
        !result.otherExp.length && !result.loose1000) {
        result.errors.push('No recognizable blocks found. Make sure you pasted the full AI output.');
    }

    return result;
}

// Parse [ENTRY] blocks inside EMPLOYMENT
function parseEmploymentEntries(blockContent, errors) {
    const entries = [];
    const entryRegex = /\[ENTRY\]([\s\S]*?)\[\/ENTRY\]/g;
    let match;
    let i = 0;

    while ((match = entryRegex.exec(blockContent)) !== null) {
        i++;
        const raw = match[1].trim();
        const entry = parseFieldLines(raw);

        const missing = ['company', 'location', 'title', 'description'].filter(k => !entry[k]);
        if (missing.length) {
            errors.push(`Employment entry ${i}: missing fields – ${missing.join(', ')}`);
            continue;
        }

        entries.push({
            company: entry['company'],
            location: entry['location'],
            title: entry['title'],
            description: entry['description']
        });
    }

    return entries;
}

// Parse [ENTRY] blocks inside OTHER_EXP
function parseOtherExpEntries(blockContent, errors) {
    const entries = [];
    const entryRegex = /\[ENTRY\]([\s\S]*?)\[\/ENTRY\]/g;
    let match;
    let i = 0;

    while ((match = entryRegex.exec(blockContent)) !== null) {
        i++;
        const raw = match[1].trim();
        const entry = parseFieldLines(raw);

        if (!entry['title'] || !entry['description']) {
            errors.push(`Other Exp entry ${i}: missing title or description`);
            continue;
        }

        if (entry['title'].length > 70) {
            errors.push(`Other Exp entry ${i}: title too long (${entry['title'].length}/70) – trimmed`);
            entry['title'] = entry['title'].substring(0, 70);
        }

        entries.push({
            title: entry['title'],
            description: entry['description']
        });
    }

    return entries;
}

// Splits "Key::Value" lines into a plain object
function parseFieldLines(text) {
    const obj = {};
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    for (const line of lines) {
        const sep = line.indexOf('::');
        if (sep === -1) continue;
        const key = line.substring(0, sep).trim().toLowerCase();
        const value = line.substring(sep + 2).trim();
        obj[key] = value;
    }
    return obj;
}

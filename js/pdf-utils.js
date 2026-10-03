/* ============================================
   PDF Utilities — shared helpers for PDF gen
   ============================================ */

const PdfUtils = (() => {

    // Placeholder letterhead. Set the real details in Settings → Company Header
    // rather than editing these.
    const COMPANY = {
        name: 'Your Company Pvt. Ltd.',
        address: '123 Example Road,\nYour City – 000 000.',
        address2: '123 Example Road,\nYour City – 000 000, INDIA.',
        gst: '',
        cin: '',
        phone: '',
        contact: '',
        email: 'accounts@example.com',
        website: 'www.example.com'
    };

    // Admin-editable overrides (Settings → Company Header) are merged over the
    // built-in defaults so an office relocation needs no code change. Stored in
    // settings.companyHeader; blank fields keep the default.
    function activeCompany() {
        const base = COMPANY;
        let override = null;
        try {
            if (typeof Storage !== 'undefined' && Storage.getSettings) {
                const ch = Storage.getSettings().companyHeader;
                if (ch && typeof ch === 'object') override = ch;
            }
        } catch (e) { /* settings unavailable — use defaults */ }
        if (!override) return base;

        const merged = Object.assign({}, base);
        Object.keys(override).forEach(k => {
            const v = override[k];
            if (v !== undefined && v !== null && String(v).trim() !== '') merged[k] = v;
        });
        // `contact` mirrors `phone` in the templates — keep them in sync.
        if (override.phone && String(override.phone).trim() !== '') merged.contact = override.phone;
        return merged;
    }

    const CURRENCY_MAP = {
        'AED': { code: 'AED', symbol: 'Dh', name: 'UAE Dirham' },
        'AFN': { code: 'AFN', symbol: '؋', name: 'Afghan Afghani' },
        'ALL': { code: 'ALL', symbol: 'L', name: 'Albanian Lek' },
        'AMD': { code: 'AMD', symbol: '֏', name: 'Armenian Dram' },
        'ANG': { code: 'ANG', symbol: 'ƒ', name: 'Netherlands Antillean Guilder' },
        'AOA': { code: 'AOA', symbol: 'Kz', name: 'Angolan Kwanza' },
        'ARS': { code: 'ARS', symbol: '$', name: 'Argentine Peso' },
        'AUD': { code: 'AUD', symbol: '$', name: 'Australian Dollar' },
        'AWG': { code: 'AWG', symbol: 'ƒ', name: 'Aruban Florin' },
        'AZN': { code: 'AZN', symbol: '₼', name: 'Azerbaijani Manat' },
        'BAM': { code: 'BAM', symbol: 'KM', name: 'Bosnia-Herzegovina Convertible Mark' },
        'BBD': { code: 'BBD', symbol: '$', name: 'Barbadian Dollar' },
        'BDT': { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka' },
        'BGN': { code: 'BGN', symbol: 'лв', name: 'Bulgarian Lev' },
        'BHD': { code: 'BHD', symbol: 'BD', name: 'Bahraini Dinar' },
        'BIF': { code: 'BIF', symbol: 'FBu', name: 'Burundian Franc' },
        'BMD': { code: 'BMD', symbol: '$', name: 'Bermudian Dollar' },
        'BND': { code: 'BND', symbol: '$', name: 'Brunei Dollar' },
        'BOB': { code: 'BOB', symbol: 'Bs.', name: 'Bolivian Boliviano' },
        'BRL': { code: 'BRL', symbol: '$', name: 'Brazilian Real' },
        'BSD': { code: 'BSD', symbol: '$', name: 'Bahamian Dollar' },
        'BTN': { code: 'BTN', symbol: 'Nu.', name: 'Bhutanese Ngultrum' },
        'BWP': { code: 'BWP', symbol: 'P', name: 'Botswanan Pula' },
        'BYN': { code: 'BYN', symbol: 'Br', name: 'Belarusian Ruble' },
        'BZD': { code: 'BZD', symbol: '$', name: 'Belize Dollar' },
        'CAD': { code: 'CAD', symbol: '$', name: 'Canadian Dollar' },
        'CDF': { code: 'CDF', symbol: 'FC', name: 'Congolese Franc' },
        'CHF': { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
        'CLP': { code: 'CLP', symbol: '$', name: 'Chilean Peso' },
        'CNY': { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
        'COP': { code: 'COP', symbol: '$', name: 'Colombian Peso' },
        'CRC': { code: 'CRC', symbol: '₡', name: 'Costa Rican Colón' },
        'CUP': { code: 'CUP', symbol: '$', name: 'Cuban Peso' },
        'CVE': { code: 'CVE', symbol: 'Esc', name: 'Cape Verdean Escudo' },
        'CZK': { code: 'CZK', symbol: 'Kč', name: 'Czech Koruna' },
        'DJF': { code: 'DJF', symbol: 'Fdj', name: 'Djiboutian Franc' },
        'DKK': { code: 'DKK', symbol: 'kr', name: 'Danish Krone' },
        'DOP': { code: 'DOP', symbol: '$', name: 'Dominican Peso' },
        'DZD': { code: 'DZD', symbol: 'DA', name: 'Algerian Dinar' },
        'EGP': { code: 'EGP', symbol: 'E£', name: 'Egyptian Pound' },
        'ERN': { code: 'ERN', symbol: 'Nfk', name: 'Eritrean Nakfa' },
        'ETB': { code: 'ETB', symbol: 'Br', name: 'Ethiopian Birr' },
        'EUR': { code: 'EUR', symbol: '€', name: 'Euro' },
        'FJD': { code: 'FJD', symbol: '$', name: 'Fijian Dollar' },
        'FKP': { code: 'FKP', symbol: '£', name: 'Falkland Islands Pound' },
        'GBP': { code: 'GBP', symbol: '£', name: 'British Pound' },
        'GEL': { code: 'GEL', symbol: '₾', name: 'Georgian Lari' },
        'GGP': { code: 'GGP', symbol: '£', name: 'Guernsey Pound' },
        'GHS': { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
        'GIP': { code: 'GIP', symbol: '£', name: 'Gibraltar Pound' },
        'GMD': { code: 'GMD', symbol: 'D', name: 'Gambian Dalasi' },
        'GNF': { code: 'GNF', symbol: 'FG', name: 'Guinean Franc' },
        'GTQ': { code: 'GTQ', symbol: 'Q', name: 'Guatemalan Quetzal' },
        'GYD': { code: 'GYD', symbol: '$', name: 'Guyanese Dollar' },
        'HKD': { code: 'HKD', symbol: '$', name: 'Hong Kong Dollar' },
        'HNL': { code: 'HNL', symbol: 'L', name: 'Honduran Lempira' },
        'HRK': { code: 'HRK', symbol: 'kn', name: 'Croatian Kuna' },
        'HTG': { code: 'HTG', symbol: 'G', name: 'Haitian Gourde' },
        'HUF': { code: 'HUF', symbol: 'Ft', name: 'Hungarian Forint' },
        'IDR': { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah' },
        'ILS': { code: 'ILS', symbol: '₪', name: 'Israeli New Shekel' },
        'IMP': { code: 'IMP', symbol: '£', name: 'Isle of Man Pound' },
        'INR': { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        'IQD': { code: 'IQD', symbol: 'ID', name: 'Iraqi Dinar' },
        'IRR': { code: 'IRR', symbol: 'IR', name: 'Iranian Rial' },
        'ISK': { code: 'ISK', symbol: 'kr', name: 'Icelandic Króna' },
        'JEP': { code: 'JEP', symbol: '£', name: 'Jersey Pound' },
        'JMD': { code: 'JMD', symbol: '$', name: 'Jamaican Dollar' },
        'JOD': { code: 'JOD', symbol: 'JD', name: 'Jordanian Dinar' },
        'JPY': { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
        'KES': { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
        'KGS': { code: 'KGS', symbol: 'с', name: 'Kyrgystani Som' },
        'KHR': { code: 'KHR', symbol: '៛', name: 'Cambodian Riel' },
        'KMF': { code: 'KMF', symbol: 'CF', name: 'Comorian Franc' },
        'KPW': { code: 'KPW', symbol: '₩', name: 'North Korean Won' },
        'KRW': { code: 'KRW', symbol: '₩', name: 'South Korean Won' },
        'KWD': { code: 'KWD', symbol: 'KD', name: 'Kuwaiti Dinar' },
        'KYD': { code: 'KYD', symbol: '$', name: 'Cayman Islands Dollar' },
        'KZT': { code: 'KZT', symbol: '₸', name: 'Kazakhstani Tenge' },
        'LAK': { code: 'LAK', symbol: '₭', name: 'Laotian Kip' },
        'LBP': { code: 'LBP', symbol: 'L£', name: 'Lebanese Pound' },
        'LKR': { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee' },
        'LRD': { code: 'LRD', symbol: '$', name: 'Liberian Dollar' },
        'LSL': { code: 'LSL', symbol: 'L', name: 'Lesotho Loti' },
        'LYD': { code: 'LYD', symbol: 'LD', name: 'Libyan Dinar' },
        'MAD': { code: 'MAD', symbol: 'DH', name: 'Moroccan Dirham' },
        'MDL': { code: 'MDL', symbol: 'L', name: 'Moldovan Leu' },
        'MGA': { code: 'MGA', symbol: 'Ar', name: 'Malagasy Ariary' },
        'MKD': { code: 'MKD', symbol: 'ден', name: 'Macedonian Denar' },
        'MMK': { code: 'MMK', symbol: 'K', name: 'Myanmar Kyat' },
        'MNT': { code: 'MNT', symbol: '₮', name: 'Mongolian Tughrik' },
        'MOP': { code: 'MOP', symbol: '$', name: 'Macanese Pataca' },
        'MRU': { code: 'MRU', symbol: 'UM', name: 'Mauritanian Ouguiya' },
        'MUR': { code: 'MUR', symbol: 'Rs', name: 'Mauritian Rupee' },
        'MVR': { code: 'MVR', symbol: 'Rf', name: 'Maldivian Rufiyaa' },
        'MWK': { code: 'MWK', symbol: 'MK', name: 'Malawian Kwacha' },
        'MXN': { code: 'MXN', symbol: '$', name: 'Mexican Peso' },
        'MYR': { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
        'MZN': { code: 'MZN', symbol: 'MT', name: 'Mozambican Metical' },
        'NAD': { code: 'NAD', symbol: '$', name: 'Namibian Dollar' },
        'NGN': { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
        'NIO': { code: 'NIO', symbol: '$', name: 'Nicaraguan Córdoba' },
        'NOK': { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
        'NPR': { code: 'NPR', symbol: 'Rs', name: 'Nepalese Rupee' },
        'NZD': { code: 'NZD', symbol: '$', name: 'New Zealand Dollar' },
        'OMR': { code: 'OMR', symbol: 'RO', name: 'Omani Rial' },
        'PAB': { code: 'PAB', symbol: 'B/.', name: 'Panamanian Balboa' },
        'PEN': { code: 'PEN', symbol: 'S/.', name: 'Peruvian Sol' },
        'PGK': { code: 'PGK', symbol: 'K', name: 'Papua New Guinean Kina' },
        'PHP': { code: 'PHP', symbol: '₱', name: 'Philippine Peso' },
        'PKR': { code: 'PKR', symbol: 'Rs', name: 'Pakistani Rupee' },
        'PLN': { code: 'PLN', symbol: 'zł', name: 'Polish Złoty' },
        'PYG': { code: 'PYG', symbol: '₲', name: 'Paraguayan Guaraní' },
        'QAR': { code: 'QAR', symbol: 'QR', name: 'Qatari Riyal' },
        'RON': { code: 'RON', symbol: 'lei', name: 'Romanian Leu' },
        'RSD': { code: 'RSD', symbol: 'дин.', name: 'Serbian Dinar' },
        'RUB': { code: 'RUB', symbol: '₽', name: 'Russian Ruble' },
        'RWF': { code: 'RWF', symbol: 'FRw', name: 'Rwandan Franc' },
        'SAR': { code: 'SAR', symbol: 'SR', name: 'Saudi Riyal' },
        'SBD': { code: 'SBD', symbol: '$', name: 'Solomon Islands Dollar' },
        'SCR': { code: 'SCR', symbol: 'Rs', name: 'Seychellois Rupee' },
        'SDG': { code: 'SDG', symbol: 'SD', name: 'Sudanese Pound' },
        'SEK': { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
        'SGD': { code: 'SGD', symbol: '$', name: 'Singapore Dollar' },
        'SHP': { code: 'SHP', symbol: '£', name: 'St. Helena Pound' },
        'SLL': { code: 'SLL', symbol: 'Le', name: 'Sierra Leonean Leone' },
        'SOS': { code: 'SOS', symbol: 'Sh.', name: 'Somali Shilling' },
        'SRD': { code: 'SRD', symbol: '$', name: 'Surinamese Dollar' },
        'SSP': { code: 'SSP', symbol: '£', name: 'South Sudanese Pound' },
        'STN': { code: 'STN', symbol: 'Db', name: 'São Tomé & Príncipe Dobra' },
        'SVC': { code: 'SVC', symbol: '$', name: 'Salvadoran Colón' },
        'SYP': { code: 'SYP', symbol: 'LS', name: 'Syrian Pound' },
        'SZL': { code: 'SZL', symbol: 'E', name: 'Swazi Lilangeni' },
        'THB': { code: 'THB', symbol: '฿', name: 'Thai Baht' },
        'TJS': { code: 'TJS', symbol: 'SM', name: 'Tajikistani Somoni' },
        'TMT': { code: 'TMT', symbol: 'T', name: 'Turkmenistani Manat' },
        'TND': { code: 'TND', symbol: 'DT', name: 'Tunisian Dinar' },
        'TOP': { code: 'TOP', symbol: '$', name: 'Tongan Paʻanga' },
        'TRY': { code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
        'TTD': { code: 'TTD', symbol: '$', name: 'Trinidad & Tobago Dollar' },
        'TWD': { code: 'TWD', symbol: '$', name: 'New Taiwan Dollar' },
        'TZS': { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling' },
        'UAH': { code: 'UAH', symbol: '₴', name: 'Ukrainian Hryvnia' },
        'UGX': { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling' },
        'USD': { code: 'USD', symbol: '$', name: 'US Dollar' },
        'UYU': { code: 'UYU', symbol: '$', name: 'Uruguayan Peso' },
        'UZS': { code: 'UZS', symbol: 'soʻm', name: 'Uzbekistani Som' },
        'VES': { code: 'VES', symbol: 'Bs.S', name: 'Venezuelan Bolívar' },
        'VND': { code: 'VND', symbol: '₫', name: 'Vietnamese Đồng' },
        'VUV': { code: 'VUV', symbol: 'Vt', name: 'Vanuatu Vatu' },
        'WST': { code: 'WST', symbol: '$', name: 'Samoan Tālā' },
        'XAF': { code: 'XAF', symbol: 'FCFA', name: 'Central African CFA Franc' },
        'XCD': { code: 'XCD', symbol: '$', name: 'East Caribbean Dollar' },
        'XOF': { code: 'XOF', symbol: 'CFA', name: 'West African CFA Franc' },
        'XPF': { code: 'XPF', symbol: '₣', name: 'CFP Franc' },
        'YER': { code: 'YER', symbol: 'YR', name: 'Yemeni Rial' },
        'ZAR': { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
        'ZMW': { code: 'ZMW', symbol: 'ZK', name: 'Zambian Kwacha' },
        'ZWL': { code: 'ZWL', symbol: '$', name: 'Zimbabwean Dollar' }
    };

    // --- Indian Number Formatting: 1,48,25,000.00 (INR only) ---
    function formatIndianCurrency(num) {
        if (num === undefined || num === null || isNaN(num)) return '0.00';
        num = parseFloat(num);
        const isNegative = num < 0;
        num = Math.abs(num);
        const parts = num.toFixed(2).split('.');
        let intPart = parts[0];
        const decPart = parts[1];

        if (intPart.length <= 3) {
            return (isNegative ? '-' : '') + intPart + '.' + decPart;
        }

        const lastThree = intPart.slice(-3);
        const remaining = intPart.slice(0, -3);
        const formatted = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
        return (isNegative ? '-' : '') + formatted + '.' + decPart;
    }

    // --- International Number Formatting: 891,000.00 (USD, EUR, GBP, etc.) ---
    function formatInternationalCurrency(num) {
        if (num === undefined || num === null || isNaN(num)) return '0.00';
        num = parseFloat(num);
        const isNegative = num < 0;
        num = Math.abs(num);
        const parts = num.toFixed(2).split('.');
        let intPart = parts[0];
        const decPart = parts[1];
        const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (isNegative ? '-' : '') + formatted + '.' + decPart;
    }

    // --- Currency symbol lookup (₹, $, C$, £, …); falls back to the code itself ---
    function currencySymbol(currency) {
        const entry = CURRENCY_MAP[currency];
        return (entry && entry.symbol) ? entry.symbol : (currency || '');
    }

    // --- Formatted amount prefixed with its currency symbol, e.g. "₹702,000.00" ---
    function formatMoney(num, currency) {
        return currencySymbol(currency) + formatCurrency(num, currency);
    }

    // Unicode code points the built-in (WinAnsi-encoded) jsPDF fonts can render
    // beyond plain ASCII: the Latin-1 supplement plus the CP1252 specials block.
    const _WINANSI_EXTRA = new Set([
        0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030,
        0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
        0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178
    ]);

    // True when every character of `str` is drawable by the built-in PDF fonts.
    // The standard 14 PDF fonts use WinAnsi encoding, so glyphs like the Rupee
    // sign ₹ (U+20B9) have no mapping and degrade to garbage (e.g. ¹).
    function _isWinAnsiSafe(str) {
        for (const ch of String(str)) {
            const cp = ch.codePointAt(0);
            if (cp <= 0x7E) continue;               // ASCII
            if (cp >= 0xA0 && cp <= 0xFF) continue; // Latin-1 supplement
            if (_WINANSI_EXTRA.has(cp)) continue;   // CP1252 specials
            return false;
        }
        return true;
    }

    // Name under which the embedded Unicode currency font is registered in jsPDF.
    const CURRENCY_FONT_NAME = 'Arimo';

    // Registers the embedded Arimo subset (see js/vendor/currency-font.js) on a
    // jsPDF document so currency glyphs the built-in fonts lack — e.g. ₹ (U+20B9)
    // — can be drawn. Safe to call once per document; no-op if already loaded or
    // if the font asset isn't present. Returns the font name on success, else null.
    function registerCurrencyFont(doc) {
        const f = (typeof window !== 'undefined') && window.CURRENCY_FONT;
        if (!doc || !f || !f.regular) return null;
        try {
            if (!doc.getFontList || !doc.getFontList()[CURRENCY_FONT_NAME]) {
                doc.addFileToVFS('Arimo-Regular.ttf', f.regular);
                doc.addFont('Arimo-Regular.ttf', CURRENCY_FONT_NAME, 'normal');
                if (f.bold) {
                    doc.addFileToVFS('Arimo-Bold.ttf', f.bold);
                    doc.addFont('Arimo-Bold.ttf', CURRENCY_FONT_NAME, 'bold');
                }
            }
            return CURRENCY_FONT_NAME;
        } catch (e) {
            console.warn('Could not register currency font:', e);
            return null;
        }
    }

    // True when `num`'s rendered symbol for `currency` needs the embedded Unicode
    // font (i.e. the built-in PDF fonts can't draw it).
    function needsCurrencyFont(currency) {
        return !_isWinAnsiSafe(currencySymbol(currency));
    }

    // --- formatMoney for PDF output (keeps the real symbol, e.g. ₹65,000.00) ---
    function formatMoneyPdf(num, currency) {
        return currencySymbol(currency) + formatCurrency(num, currency);
    }

    // Round a grand total to the nearest whole unit: a fractional part of .5 or
    // more rounds up, .4 or less rounds down (standard half-up). Returns the
    // rounded total and the signed adjustment (rounded − original).
    function roundOffTotal(total) {
        const n = Number(total) || 0;
        const rounded = Math.round(n);
        const delta = Math.round((rounded - n) * 100) / 100;
        return { rounded, delta };
    }

    // Signed money for the round-off adjustment line, e.g. "+ ₹0.50" / "- ₹0.40".
    function formatRoundOffDelta(delta, currency) {
        const sign = delta >= 0 ? '+ ' : '- ';
        return sign + formatMoney(Math.abs(delta), currency);
    }

    // --- Smart dispatcher: Indian for INR, International for all other currencies ---
    function formatCurrency(num, currency) {
        if (currency === 'INR') return formatIndianCurrency(num);
        return formatInternationalCurrency(num);
    }

    // --- Fractional units map ---
    const fractionalNames = {
        'INR': 'Paise',
        'USD': 'Cents',
        'EUR': 'Cents',
        'GBP': 'Pence',
        'AED': 'Fils',
        'SGD': 'Cents',
        'AUD': 'Cents',
        'CAD': 'Cents'
    };

    // --- Number to Words ---
    function numberToWords(num, currency = 'INR') {
        if (num === 0) return 'Zero';
        if (num === undefined || num === null || isNaN(num)) return '';

        num = Math.abs(parseFloat(num));
        const wholePart = Math.floor(num);
        const paisePart = Math.round((num - wholePart) * 100);

        const isIndian = currency === 'INR';
        let result = isIndian ? _convertWholeToWords(wholePart) : _convertWholeToInternationalWords(wholePart);

        if (paisePart > 0) {
            const fracName = fractionalNames[currency] || 'Cents';
            const fracWords = isIndian ? _convertWholeToWords(paisePart) : _convertWholeToInternationalWords(paisePart);
            result += ' and ' + fracWords + ' ' + fracName;
        }

        return result + ' only.';
    }

    function _convertWholeToWords(n) {
        if (n === 0) return '';

        const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
            'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
            'Seventeen', 'Eighteen', 'Nineteen'];
        const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
        if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + _convertWholeToWords(n % 100) : '');
        if (n < 100000) return _convertWholeToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + _convertWholeToWords(n % 1000) : '');
        if (n < 10000000) return _convertWholeToWords(Math.floor(n / 100000)) + ' Lakhs' + (n % 100000 ? ' ' + _convertWholeToWords(n % 100000) : '');
        return _convertWholeToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + _convertWholeToWords(n % 10000000) : '');
    }

    function _convertWholeToInternationalWords(n) {
        if (n === 0) return '';

        const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
            'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
            'Seventeen', 'Eighteen', 'Nineteen'];
        const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
        if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + _convertWholeToInternationalWords(n % 100) : '');
        if (n < 1000000) return _convertWholeToInternationalWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + _convertWholeToInternationalWords(n % 1000) : '');
        if (n < 1000000000) return _convertWholeToInternationalWords(Math.floor(n / 1000000)) + ' Million' + (n % 1000000 ? ' ' + _convertWholeToInternationalWords(n % 1000000) : '');
        return _convertWholeToInternationalWords(Math.floor(n / 1000000000)) + ' Billion' + (n % 1000000000 ? ' ' + _convertWholeToInternationalWords(n % 1000000000) : '');
    }

    const currencyNames = {
        'INR': 'Rupees',
        'USD': 'US Dollars',
        'EUR': 'Euros',
        'GBP': 'Pounds',
        'AED': 'UAE Dirhams',
        'SGD': 'Singapore Dollars',
        'AUD': 'Australian Dollars',
        'CAD': 'Canadian Dollars'
    };

    // Build full currency string
    function amountInWords(num, currency = 'INR') {
        if (!num || isNaN(num) || num === 0) return '';
        
        num = Math.abs(parseFloat(num));
        const wholePart = Math.floor(num);
        const paisePart = Math.round((num - wholePart) * 100);

        const isIndian = currency === 'INR';
        const currName = currencyNames[currency] || currency;
        const fracName = fractionalNames[currency] || 'Cents';

        if (wholePart === 0 && paisePart > 0) {
            const fracWords = isIndian ? _convertWholeToWords(paisePart) : _convertWholeToInternationalWords(paisePart);
            return fracWords + ' ' + fracName + '.';
        }

        const wholeWords = isIndian ? _convertWholeToWords(wholePart) : _convertWholeToInternationalWords(wholePart);
        let result = wholeWords + ' ' + currName;

        if (paisePart > 0) {
            const fracWords = isIndian ? _convertWholeToWords(paisePart) : _convertWholeToInternationalWords(paisePart);
            result += ' and ' + fracWords + ' ' + fracName;
        }

        return result.trim() + '.';
    }

    // --- jsPDF image format from a data URL (e.g. 'data:image/jpeg;...' -> 'JPEG') ---
    function getDataUrlFormat(dataUrl) {
        const m = /^data:image\/(\w+)/i.exec(dataUrl || '');
        if (!m) return 'PNG';
        const fmt = m[1].toUpperCase();
        return fmt === 'JPG' ? 'JPEG' : fmt;
    }

    // --- Natural pixel dimensions of an image (data URL or src). Resolves null on error. ---
    function getImageDimensions(dataUrl) {
        return new Promise((resolve) => {
            if (!dataUrl) { resolve(null); return; }
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve(null);
            img.src = dataUrl;
        });
    }

    // --- Downscale an image to the pixel size it will actually be printed at ---
    // A logo/signature printed at a few centimetres only needs a few hundred pixels
    // at 300 DPI (print quality). Embedding a multi-megapixel phone photo instead
    // bloats every PDF to several MB. This re-encodes the image to the print size,
    // which is visually identical on paper but a tiny fraction of the bytes. PNGs
    // keep their alpha (so transparent stamps stay transparent); never upscales.
    function rasterizeForPrint(dataUrl, targetWmm, targetHmm, dpi, opts) {
        dpi = dpi || 300;
        opts = opts || {};
        return new Promise((resolve) => {
            if (!dataUrl || typeof document === 'undefined') { resolve(dataUrl); return; }
            try {
                const img = new Image();
                img.onload = () => {
                    try {
                        const maxW = Math.max(1, Math.round((targetWmm / 25.4) * dpi));
                        const maxH = Math.max(1, Math.round((targetHmm / 25.4) * dpi));
                        const nw = img.naturalWidth || maxW, nh = img.naturalHeight || maxH;
                        const scale = Math.min(1, maxW / nw, maxH / nh); // never upscale
                        const w = Math.max(1, Math.round(nw * scale));
                        const h = Math.max(1, Math.round(nh * scale));
                        // Nothing to do only if not downscaling AND not re-encoding.
                        if (scale >= 1 && !opts.mime && !opts.background) { resolve(dataUrl); return; }
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        // Flatten onto a background (e.g. white) for JPEG output, which
                        // can't store transparency.
                        if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, w, h); }
                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = 'high';
                        ctx.drawImage(img, 0, 0, w, h);
                        // JPEG is far smaller for gradient/photo content; PNG keeps alpha
                        // (so transparent signatures/stamps overlay cleanly).
                        const isJpeg = opts.mime ? /jpe?g/i.test(opts.mime) : /^data:image\/jpe?g/i.test(dataUrl);
                        const mime = opts.mime || (isJpeg ? 'image/jpeg' : 'image/png');
                        resolve(canvas.toDataURL(mime, opts.quality != null ? opts.quality : 0.92));
                    } catch (e) { resolve(dataUrl); }
                };
                img.onerror = () => resolve(dataUrl);
                img.src = dataUrl;
            } catch (e) { resolve(dataUrl); }
        });
    }

    // --- Format date as DD-Mon-YYYY (29-Jul-2026) ---
    // Returns '' for an unparseable date so nothing ever renders as
    // "NaN-undefined-NaN".
    function formatDateDMY(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = String(d.getDate()).padStart(2, '0');
        const mon = months[d.getMonth()];
        const year = d.getFullYear();
        return `${day}-${mon}-${year}`;
    }

    // --- Format date as DD.MM.YYYY ---
    function formatDateDot(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth()+1).padStart(2, '0')}.${d.getFullYear()}`;
    }

    // Letterhead logo: the company's own, uploaded in Settings → Company Header
    // (already downscaled for print on upload). None uploaded → no logo; the
    // Vectis logo is app branding and never goes on a company's documents.
    async function getLogoBase64() {
        const s = (typeof Storage !== 'undefined' && Storage.getSettings) ? Storage.getSettings() : {};
        return s.companyLogo || null;
    }

    // --- Read file input as base64 ---
    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }    // --- Draw Custom Header Icons (Location Pin, Mail, Phone) using Native jsPDF Primitives ---
    function drawLocationIcon(doc, cx, cy) {
        doc.setDrawColor(0, 77, 44);
        doc.setLineWidth(0.25);
        
        // Top circle outline
        doc.circle(cx, cy - 0.15, 0.75, 'S');
        
        // White triangle mask to cover the bottom arc of the circle
        doc.setFillColor(255, 255, 255);
        doc.triangle(cx - 0.75, cy - 0.15, cx + 0.75, cy - 0.15, cx, cy + 1.1, 'F');
        
        // Green side lines
        doc.setDrawColor(0, 77, 44);
        doc.line(cx - 0.75, cy - 0.15, cx, cy + 1.1);
        doc.line(cx + 0.75, cy - 0.15, cx, cy + 1.1);
        
        // Inner filled dot
        doc.setFillColor(0, 77, 44);
        doc.circle(cx, cy - 0.15, 0.22, 'F');
    }

    function drawMailIcon(doc, cx, cy) {
        doc.setDrawColor(0, 77, 44);
        doc.setLineWidth(0.25);
        
        // Envelope body: rounded rectangle
        doc.roundedRect(cx - 1.25, cy - 0.95, 2.5, 1.9, 0.3, 0.3, 'S');
        
        // V-fold lines
        doc.line(cx - 1.2, cy - 0.8, cx, cy + 0.05);
        doc.line(cx + 1.2, cy - 0.8, cx, cy + 0.05);
    }

    function drawPhoneIcon(doc, cx, cy, size = 2.4) {
        doc.setDrawColor(0, 77, 44);
        doc.setLineWidth(0.25);
        
        const ox = cx - 1.2;
        const oy = cy - 1.2;
        const s = size / 24; // size = 2.4mm, so scale = 2.4/24 = 0.1
        
        const lines = [
            [0, 0.3],
            [0, 0.2, 0, 0.2, -0.218, 0.2],
            [-1.482, -0.692, -1.482, -0.692, -1.77, -1.774],
            [0, -0.218, 0, -0.218, 0.199, -0.218],
            [0.3, 0],
            [0.2, 0.2, 0.2, 0.2, 0.225, 0.664],
            [-0.127, 0.127],
            [0.3, 0.3, 0.3, 0.3, 0.6, 0.6],
            [0.127, -0.127],
            [0.464, 0.025, 0.464, 0.025, 0.664, 0.228]
        ];
        
        doc.lines(lines, ox + 2.2, oy + 1.692, [1, 1], 'S', true);
    }

    function drawHeaderIcons(doc, y) {
        drawLocationIcon(doc, 106.25, y + 7.2);
        drawMailIcon(doc, 106.25, y + 11.7);
        drawPhoneIcon(doc, 106.25, y + 16.2, 2.4);
    }

    // --- Globe / Website Icon ---
    function drawGlobeIcon(doc, cx, cy, r = 1.25) {
        doc.setDrawColor(0, 77, 44);
        doc.setLineWidth(0.25);

        // Outer globe
        doc.circle(cx, cy, r, 'S');
        // Meridian (vertical ellipse)
        doc.ellipse(cx, cy, r * 0.45, r, 'S');
        // Equator
        doc.line(cx - r, cy, cx + r, cy);
        // Two latitude lines for a richer, more finished look
        const dy = r * 0.55;
        const dx = Math.sqrt(Math.max(r * r - dy * dy, 0));
        doc.line(cx - dx, cy - dy, cx + dx, cy - dy);
        doc.line(cx - dx, cy + dy, cx + dx, cy + dy);
    }

    // --- Premium right-aligned contact column with leading icons ---
    // rightX: right edge to align text to. firstBaselineY: baseline of the first row.
    // lineGap: vertical spacing between rows. company: object with website/email/phone.
    function drawContactColumn(doc, rightX, firstBaselineY, lineGap, company) {
        const ORANGE = [243, 123, 33];
        const GREY = [51, 51, 51];

        const rows = [];
        if (company.website) rows.push({ type: 'web', text: company.website, color: GREY });
        if (company.email)   rows.push({ type: 'mail', text: company.email, color: ORANGE });
        if (company.phone)   rows.push({ type: 'phone', text: company.phone, color: GREY });
        if (!rows.length) return;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);

        // Align every icon to a single vertical column based on the widest line
        let maxW = 0;
        rows.forEach(r => { maxW = Math.max(maxW, doc.getTextWidth(r.text)); });

        const iconHalf = 1.3;   // half the icon footprint
        const gap = 2.0;        // space between icon and text
        const iconCenterX = rightX - maxW - gap - iconHalf;

        let lastBaseline = firstBaselineY;
        rows.forEach((r, i) => {
            const baselineY = firstBaselineY + i * lineGap;
            lastBaseline = baselineY;
            const cy = baselineY - 1.05; // visually centre the icon on the text

            if (r.type === 'web') drawGlobeIcon(doc, iconCenterX, cy, 1.25);
            else if (r.type === 'mail') drawMailIcon(doc, iconCenterX, cy);
            else drawPhoneIcon(doc, iconCenterX, cy, 2.5);

            doc.setTextColor(r.color[0], r.color[1], r.color[2]);
            doc.text(r.text, rightX, baselineY, { align: 'right' });
        });

        doc.setTextColor(51, 51, 51);
        return lastBaseline; // baseline of the final contact row
    }

    // --- Full premium letterhead: logo on the left, all company details
    //     (name / address / GST / contacts) right-aligned in one column.
    //     Returns the y just below the header block. ---
    function drawLetterhead(doc, logo, pageWidth, margin, y, showGst = true) {
        const leftX = margin;
        const blockTop = y + 1;
        const co = activeCompany();

        // Company name (left-aligned)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(0, 77, 44);
        doc.text((co.name || '').toUpperCase(), leftX, y + 4);

        // Address — clean lines (drop any trailing comma/period)
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(51, 51, 51);
        let hy = y + 10;
        (co.address || '').split('\n').forEach(line => {
            doc.text(line.trim(), leftX, hy);
            hy += 4.6;
        });

        // --- Contact: three left-aligned lines, each with a leading icon ---
        //     1) Website   2) Email   3) Phone
        const GREY = [51, 51, 51]; // same tone as the address text
        const iconGap = 1.8;   // space between an icon and its text
        const iconHalf = 1.3;  // half the icon footprint
        const textStartX = leftX + 2 * iconHalf + iconGap;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);

        // 1) Website (clickable)
        if (co.website) {
            const cy = hy - 1.05;
            drawGlobeIcon(doc, leftX + iconHalf, cy, 1.25);
            doc.setTextColor(GREY[0], GREY[1], GREY[2]);
            doc.textWithLink(co.website, textStartX, hy, { url: 'https://' + co.website });
            hy += 4.6;
        }
        // 2) Email
        if (co.email) {
            const cy = hy - 1.05;
            drawMailIcon(doc, leftX + iconHalf, cy);
            doc.setTextColor(GREY[0], GREY[1], GREY[2]);
            doc.text(co.email, textStartX, hy);
            hy += 4.6;
        }
        // 3) Phone
        if (co.phone) {
            const cy = hy - 1.05;
            drawPhoneIcon(doc, leftX + iconHalf, cy, 2.5);
            doc.setTextColor(GREY[0], GREY[1], GREY[2]);
            doc.text(co.phone, textStartX, hy);
            hy += 4.6;
        }
        doc.setTextColor(51, 51, 51);

        // GST — bold and at the same size as the client/supplier GST in the body,
        // sitting just beneath the contact lines. Mandatory for domestic documents.
        let blockBottom = hy - 4.6; // last drawn contact line when GST is hidden
        if (showGst && co.gst) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(51, 51, 51);
            doc.text('GST: ' + co.gst, leftX, hy);
            doc.setFont('helvetica', 'normal');
            blockBottom = hy;
        }

        if (logo) {
            // Fit any logo shape into the right-hand slot (72.8 × ~19 mm) without
            // stretching it. A logo jsPDF can't read is skipped, not fatal.
            try {
                const boxW = 72.8, boxH = boxW * (14.686 / 55.545);
                const { width, height } = doc.getImageProperties(logo);
                const scale = Math.min(boxW / width, boxH / height);
                const logoW = width * scale, logoH = height * scale;
                const logoX = pageWidth - margin - logoW;
                const logoY = blockTop + ((blockBottom - blockTop) - logoH) / 2;
                doc.addImage(logo, getDataUrlFormat(logo), logoX, logoY, logoW, logoH, undefined, 'FAST');
            } catch (e) {
                console.warn('Company logo could not be placed on the PDF:', e);
            }
        }

        return blockBottom + 3.5;
    }

    // Ensure pdf.js worker URL is configured
    function _ensurePdfWorker() {
        if (typeof window === 'undefined' || !window.pdfjsLib) return false;
        try {
            if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
            }
            return true;
        } catch (e) { return false; }
    }

    // --- Convert vector jsPDF document to non-editable image-based PDF ---
    // Renders each page of the generated layout to a high-resolution canvas image
    // (PNG/JPEG) and embeds the image full-bleed into a new PDF. This produces a
    // final PDF containing only image data, completely preventing text editing in
    // PDF editors (Acrobat, Foxit, online tools) while preserving the exact layout.
    async function flattenToImagePdf(doc, opts = {}) {
        if (!doc) return doc;
        if (!_ensurePdfWorker()) {
            console.warn('pdf.js worker unavailable, returning original doc');
            return doc;
        }

        const timeoutMs = opts.timeoutMs || 15000;

        const processPromise = (async () => {
            const pdfBytes = doc.output('arraybuffer');
            const pdfjsLib = window.pdfjsLib;
            const loadingTask = pdfjsLib.getDocument({
                data: new Uint8Array(pdfBytes),
                isEvalSupported: false
            });
            const pdf = await loadingTask.promise;

            const jsPDFc = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
            let imgDoc = null;
            const pageImages = [];

            const dpi = opts.dpi || 200;
            const format = opts.format || 'PNG';
            const quality = opts.quality != null ? opts.quality : 0.95;

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const vp1 = page.getViewport({ scale: 1 });             // 72 DPI points
                const viewport = page.getViewport({ scale: dpi / 72 }); // Render resolution

                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.ceil(viewport.width));
                canvas.height = Math.max(1, Math.ceil(viewport.height));
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                await page.render({ canvasContext: ctx, viewport }).promise;

                const imgType = format === 'PNG' ? 'image/png' : 'image/jpeg';
                const imgData = canvas.toDataURL(imgType, quality);
                pageImages.push(imgData);
                const orient = vp1.width > vp1.height ? 'l' : 'p';

                if (!imgDoc) {
                    imgDoc = new jsPDFc({ unit: 'pt', format: [vp1.width, vp1.height], orientation: orient });
                } else {
                    imgDoc.addPage([vp1.width, vp1.height], orient);
                }

                const pdfImgFmt = format === 'PNG' ? 'PNG' : 'JPEG';
                imgDoc.addImage(imgData, pdfImgFmt, 0, 0, vp1.width, vp1.height, undefined, 'FAST');
                canvas.width = canvas.height = 0; // free memory
            }

            try { loadingTask.destroy && loadingTask.destroy(); } catch (e) {}
            if (imgDoc) {
                imgDoc._pageImages = pageImages;
            }
            return imgDoc || doc;
        })();

        const timeoutPromise = new Promise(resolve => {
            setTimeout(() => {
                console.warn('flattenToImagePdf timed out after ' + timeoutMs + 'ms, returning original vector doc');
                resolve(doc);
            }, timeoutMs);
        });

        try {
            return await Promise.race([processPromise, timeoutPromise]);
        } catch (err) {
            console.error('Error in flattenToImagePdf:', err);
            return doc;
        }
    }

    // Directly open the PDF in the browser's native PDF opener window/tab instantly
    function openPdfPreview(doc, targetWin, title) {
        if (!doc) return;

        let pdfBlobUrl = '';
        try {
            const pdfBlob = doc.output('blob');
            pdfBlobUrl = URL.createObjectURL(pdfBlob);
        } catch (e) {
            console.error('Failed to create PDF blob:', e);
            return;
        }

        if (targetWin && !targetWin.closed) {
            try {
                targetWin.location.replace(pdfBlobUrl);
                return;
            } catch (e) {
                try {
                    targetWin.location.href = pdfBlobUrl;
                    return;
                } catch (e2) {}
            }
        }

        window.open(pdfBlobUrl, '_blank');
    }

    // --- Dynamic Column Width & Layout Auto-Adjustment for PDF Tables ---
    // Automatically sizes columns based on their actual header and cell content lengths,
    // applies comfortable margins/padding, and gives flexible text columns the remaining space.
    function autoAdjustTableColumns(doc, cols, items, getValue, contentWidth = 190, fontSize = 9.5) {
        if (!cols || cols.length === 0) return [];

        function _measure(text, bold = false) {
            if (!text) return 0;
            try {
                doc.setFont('helvetica', bold ? 'bold' : 'normal');
                doc.setFontSize(fontSize);
                let max = 0;
                String(text).split('\n').forEach(line => {
                    const w = doc.getTextWidth(line.trim());
                    if (w > max) max = w;
                });
                return max;
            } catch (e) {
                return String(text).length * 1.8;
            }
        }

        const padding = 6; // ~3mm left + 3mm right cell padding & safety buffer

        const bounds = {
            sno: { min: 11, max: 16 },
            qty: { min: 12, max: 22 },
            uom: { min: 13, max: 24 },
            hours: { min: 13, max: 24 },
            rate: { min: 25, max: 44 },
            amount: { min: 26, max: 46 }
        };

        const textColIds = new Set(['spec', 'desc', 'name']);
        const nonTextCols = cols.filter(c => !textColIds.has(c.id));
        const textCols = cols.filter(c => textColIds.has(c.id));

        let fixedWidthSum = 0;
        const computedWidths = {};

        nonTextCols.forEach(col => {
            const headW = _measure(col.header, true);
            let maxValW = 0;
            (items || []).forEach((it, idx) => {
                const val = getValue ? getValue(it, col.id, idx) : '';
                const w = _measure(val, false);
                if (w > maxValW) maxValW = w;
            });

            let targetW = Math.max(headW, maxValW) + padding;
            const b = bounds[col.id] || { min: 15, max: 35 };
            targetW = Math.max(b.min, Math.min(b.max, targetW));
            computedWidths[col.id] = targetW;
            fixedWidthSum += targetW;
        });

        const minTextTotal = 40 * (textCols.length || 1);
        if (fixedWidthSum + minTextTotal > contentWidth) {
            // Scale down fixed columns proportionally if overcrowded
            const availableForFixed = contentWidth - minTextTotal;
            const factor = Math.max(0.5, availableForFixed / (fixedWidthSum || 1));
            fixedWidthSum = 0;
            nonTextCols.forEach(col => {
                computedWidths[col.id] = Math.round(computedWidths[col.id] * factor * 10) / 10;
                fixedWidthSum += computedWidths[col.id];
            });
        }

        const remainingWidth = Math.max(20, contentWidth - fixedWidthSum);

        if (textCols.length === 1) {
            computedWidths[textCols[0].id] = Math.round(remainingWidth * 10) / 10;
        } else if (textCols.length > 1) {
            const totalBaseRatio = textCols.reduce((sum, c) => sum + (c.baseWidth || 1), 0);
            let allocated = 0;
            textCols.forEach((c, i) => {
                if (i === textCols.length - 1) {
                    computedWidths[c.id] = Math.round((remainingWidth - allocated) * 10) / 10;
                } else {
                    const w = Math.round(((c.baseWidth || 1) / totalBaseRatio) * remainingWidth * 10) / 10;
                    computedWidths[c.id] = w;
                    allocated += w;
                }
            });
        } else if (textCols.length === 0) {
            const factor = contentWidth / (fixedWidthSum || 1);
            nonTextCols.forEach(c => {
                computedWidths[c.id] = Math.round(computedWidths[c.id] * factor * 10) / 10;
            });
        }

        return cols.map(c => ({
            id: c.id,
            header: c.header,
            halign: c.halign,
            width: computedWidths[c.id] || Math.round(((c.baseWidth || 20) / 100) * contentWidth * 10) / 10
        }));
    }

    return {
        COMPANY,
        activeCompany,
        CURRENCY_MAP,
        formatIndianCurrency,
        formatInternationalCurrency,
        formatCurrency,
        currencySymbol,
        formatMoney,
        formatMoneyPdf,
        roundOffTotal,
        formatRoundOffDelta,
        registerCurrencyFont,
        needsCurrencyFont,
        numberToWords,
        amountInWords,
        getImageDimensions,
        rasterizeForPrint,
        getDataUrlFormat,
        formatDateDMY,
        formatDateDot,
        getLogoBase64,
        readFileAsBase64,
        drawHeaderIcons,
        drawGlobeIcon,
        drawContactColumn,
        drawLetterhead,
        flattenToImagePdf,
        openPdfPreview,
        autoAdjustTableColumns
    };
})();

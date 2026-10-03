/* ============================================
   Finance Utilities — shared tax/total calculations
   Single source of truth for all financial math.
   ============================================ */

const FinanceUtils = (() => {

    /**
     * Round a number strictly to 2 decimal places (standard half-up financial rounding).
     * e.g. 135712.12604 -> 135712.13
     *      29081.49664 -> 29081.50
     *      27954.165 -> 27954.17
     *
     * @param {number|string} val
     * @returns {number}
     */
    function round2(val) {
        const n = Number(val) || 0;
        if (isNaN(n) || n === 0) return 0;
        const x = Math.round(n * 100000) / 100000;
        return Math.round(x * 100) / 100;
    }
    const truncate2 = round2;

    /**
     * Calculate all tax and total amounts from a subtotal and settings.
     *
     * @param {number} subtotal — Sum of all line-item amounts
     * @param {Object} settings — Settings object from Storage.getSettings()
     * @returns {Object} Computed financial breakdown:
     *   { gstEnabled, taxEnabled,
     *     cgstRate, sgstRate, taxRate,
     *     cgstAmount, sgstAmount, taxAmount,
     *     grandTotal }
     */
    function calculateTotals(subtotal, settings, gstNumber = '') {
        // Enforce strict 2-decimal restriction on net value without rounding off
        subtotal = truncate2(subtotal);

        const gstEnabled = settings.gstEnabled === true;

        const cgstRate = settings.cgst !== undefined ? settings.cgst : 9;
        const sgstRate = settings.sgst !== undefined ? settings.sgst : 9;
        const igstRate = settings.igst !== undefined ? settings.igst : 18;

        let cgstAmount = 0;
        let sgstAmount = 0;
        let igstAmount = 0;
        let grandTotal = subtotal;

        // Inter-state (IGST) when the client's GSTIN state code differs from ours
        // (first two digits of the company GSTIN in Settings → Company Header).
        // Without both GSTINs we can't tell, so it stays intra-state (CGST+SGST).
        const homeGst = (typeof PdfUtils !== 'undefined' && PdfUtils.activeCompany)
            ? String(PdfUtils.activeCompany().gst || '').trim() : '';
        let isInterState = false;
        if (gstNumber && homeGst) {
            isInterState = gstNumber.trim().slice(0, 2) !== homeGst.slice(0, 2);
        }

        // Round a money value to 2 decimals (standard half-up), with a tiny epsilon
        // so an exact 2-decimal value isn't bumped by float noise.
        const round2 = (n) => {
            const x = Math.round((Number(n) || 0) * 100000) / 100000;
            return Math.round(x * 100) / 100;
        };

        if (gstEnabled) {
            if (isInterState) {
                // IGST: round the tax to 2 decimals, then build the grand total
                // from the rounded tax so every line adds up exactly.
                igstAmount = round2((subtotal * igstRate) / 100);
                grandTotal = subtotal + igstAmount;
            } else {
                // Round the COMBINED CGST+SGST to 2 decimals; split it back so the
                // two displayed lines sum exactly to that rounded total.
                const combined = round2((subtotal * (cgstRate + sgstRate)) / 100);
                cgstAmount = round2((subtotal * cgstRate) / 100);
                sgstAmount = Math.round((combined - cgstAmount) * 100) / 100;
                grandTotal = subtotal + combined;
            }
        }

        return {
            gstEnabled,
            isInterState,
            cgstRate,
            sgstRate,
            igstRate,
            cgstAmount,
            sgstAmount,
            igstAmount,
            grandTotal
        };
    }

    return { calculateTotals, truncate2, round2 };
})();

"""Domain knowledge for the eight ATC drug groups in the sales dataset.

Kept as plain Python so the training/export scripts can turn it into JSON
artifacts that the API and the browser both read. Facts here are general
pharmacy reference information, not patient-specific medical advice.
"""

CATEGORIES = {
    "M01AB": {
        "name": "Acetic acid NSAIDs",
        "group": "Anti-inflammatory and antirheumatic, non-steroidal",
        "examples": ["Diclofenac", "Indometacin", "Ketorolac", "Aceclofenac"],
        "uses": "Short term relief of pain, inflammation and stiffness in joints "
                "and muscles, including arthritis and acute injury.",
        "seasonality": "Fairly steady through the year with mild winter demand.",
        "storage": "Store below 25 C in a dry place, away from direct light.",
        "cautions": "Can irritate the stomach lining and affect kidney function. "
                    "Taken with food. Avoided in active stomach ulcers.",
        "shelf_life_days": 730,
    },
    "M01AE": {
        "name": "Propionic acid NSAIDs",
        "group": "Anti-inflammatory and antirheumatic, non-steroidal",
        "examples": ["Ibuprofen", "Naproxen", "Ketoprofen", "Dexibuprofen"],
        "uses": "Everyday pain, fever, period pain and inflammatory conditions. "
                "Ibuprofen is one of the most common over the counter analgesics.",
        "seasonality": "Rises during cold and flu season in autumn and winter.",
        "storage": "Store below 25 C in a dry place.",
        "cautions": "Use the lowest effective dose. Caution in asthma, stomach "
                    "problems and pregnancy.",
        "shelf_life_days": 912,
    },
    "N02BA": {
        "name": "Salicylic acid analgesics",
        "group": "Other analgesics and antipyretics",
        "examples": ["Aspirin (acetylsalicylic acid)", "Diflunisal"],
        "uses": "Pain and fever relief. Low dose aspirin is also used long term to "
                "reduce the risk of blood clots under medical supervision.",
        "seasonality": "Steady demand with a small winter lift.",
        "storage": "Store below 25 C, keep the pack tightly closed.",
        "cautions": "Not given to children under 16 due to the risk of Reye "
                    "syndrome. Increases bleeding risk.",
        "shelf_life_days": 1095,
    },
    "N02BE": {
        "name": "Anilide analgesics",
        "group": "Other analgesics and antipyretics",
        "examples": ["Paracetamol (acetaminophen)", "Metamizole", "Phenacetin"],
        "uses": "First line relief of mild to moderate pain and fever. The highest "
                "volume analgesic group in most pharmacies.",
        "seasonality": "Strong peaks during winter cold and flu season.",
        "storage": "Store below 25 C in a dry place.",
        "cautions": "Keep within the daily maximum. Overdose can cause serious "
                    "liver harm, so total paracetamol from all products is tracked.",
        "shelf_life_days": 1095,
    },
    "N05B": {
        "name": "Anxiolytics",
        "group": "Psycholeptics",
        "examples": ["Diazepam", "Alprazolam", "Lorazepam", "Bromazepam"],
        "uses": "Short term relief of severe anxiety and related tension. "
                "Prescription only and dispensed with care.",
        "seasonality": "Stable demand with little seasonal pattern.",
        "storage": "Store below 25 C. Controlled stock with restricted access.",
        "cautions": "Risk of dependence with longer use. Avoided with alcohol. "
                    "Dispensed strictly against a valid prescription.",
        "shelf_life_days": 1460,
    },
    "N05C": {
        "name": "Hypnotics and sedatives",
        "group": "Psycholeptics",
        "examples": ["Zolpidem", "Nitrazepam", "Zopiclone", "Melatonin"],
        "uses": "Short term treatment of sleep problems. Lowest volume group in "
                "the dataset and tightly controlled.",
        "seasonality": "Low and steady volume.",
        "storage": "Store below 25 C. Controlled stock with restricted access.",
        "cautions": "Intended for short courses. Can affect next day alertness "
                    "and driving.",
        "shelf_life_days": 1460,
    },
    "R03": {
        "name": "Airway disease drugs",
        "group": "Drugs for obstructive airway diseases",
        "examples": ["Salbutamol", "Budesonide", "Formoterol", "Ipratropium"],
        "uses": "Relief and prevention of asthma and chronic obstructive pulmonary "
                "disease, mostly as inhalers.",
        "seasonality": "Peaks in cold months and during high pollen periods.",
        "storage": "Store below 25 C. Inhaler canisters are kept away from heat "
                   "and are not pierced or burned.",
        "cautions": "Reliever and preventer inhalers have different roles. Patients "
                    "are shown correct inhaler technique.",
        "shelf_life_days": 540,
    },
    "R06": {
        "name": "Systemic antihistamines",
        "group": "Antihistamines for systemic use",
        "examples": ["Cetirizine", "Loratadine", "Diphenhydramine", "Fexofenadine"],
        "uses": "Hay fever, allergic rhinitis, hives and other allergic reactions. "
                "Some older ones also help with short term sleep.",
        "seasonality": "Strong spring and summer peak driven by pollen.",
        "storage": "Store below 25 C in a dry place.",
        "cautions": "Older antihistamines can cause drowsiness. Newer ones are "
                    "less sedating and preferred for daytime use.",
        "shelf_life_days": 912,
    },
}

# General pharmacy operations knowledge for the assistant to ground on.
OPERATIONS = [
    {
        "id": "ops-reorder",
        "title": "How reorder points work",
        "text": "A reorder point is the stock level that triggers a new order. In "
                "this platform it is the forecast demand over the supplier lead "
                "time plus a safety buffer sized from recent demand variability. "
                "When stock on hand falls to or below the reorder point the item is "
                "flagged for restocking.",
    },
    {
        "id": "ops-safety-stock",
        "title": "Safety stock",
        "text": "Safety stock covers demand that is higher than expected during the "
                "lead time. It is larger for items whose daily sales swing a lot and "
                "smaller for steady sellers. It protects against stockouts without "
                "tying up cash in excess inventory.",
    },
    {
        "id": "ops-expiry",
        "title": "Expiry management",
        "text": "Stock is dispensed oldest batch first so that medicines are used "
                "well before their expiry date. Batches within 90 days of expiry are "
                "flagged early, and anything within 30 days is treated as urgent so "
                "it can be used, returned or written off before it becomes waste.",
    },
    {
        "id": "ops-anomaly",
        "title": "Unusual sales days",
        "text": "An unusual sales day is one where the quantity sold is far from what "
                "recent history and the day of week would predict. These days are "
                "worth a quick check for data entry errors, local demand spikes, or "
                "possible stock shrinkage.",
    },
    {
        "id": "ops-forecast",
        "title": "How the demand forecast is made",
        "text": "Daily demand for each drug group is predicted with a gradient "
                "boosted tree model that reads recent sales, the day of week, the "
                "time of year and rolling averages. It is compared against a simple "
                "same weekday baseline so the reported accuracy is honest.",
    },
]

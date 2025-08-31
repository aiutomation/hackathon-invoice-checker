# utils/invoice_utils.py

from invoice_schema import ITEM_COLUMNS

def to_structured(extractions):
    """
    Convert raw Extraction objects into a tidy dict grouped by
    supplier, buyer, invoice, and items.
    """
    out = {"supplier": {}, "buyer": {}, "invoice": {}, "items": []}

    def norm_quotes(s):
        return s.replace("’", "'") if isinstance(s, str) else s

    for x in (extractions or []):
        cls = getattr(x, "extraction_class", None)
        attrs = getattr(x, "attributes", None) or {}
        text = norm_quotes(getattr(x, "extraction_text", ""))

        if cls == "field":
            sec = attrs.get("section")
            name = norm_quotes(attrs.get("field_name"))
            if sec in out and name and text:
                # prefer longer text if duplicate
                cur = out[sec].get(name, "")
                out[sec][name] = text if len(text) > len(cur) else cur

        elif cls == "line_item" and attrs.get("section") == "items":
            cols = {k: v for k, v in (attrs.get("columns") or {}).items()
                    if k in ITEM_COLUMNS and v}
            if cols:
                out["items"].append(cols)

    return out


def validate_invoice(structured: dict) -> dict:
    """
    Run simple validations on the structured invoice data.
    Returns a dict with 'ok': bool and a list of 'issues'.
    """
    issues = []

    # Check mandatory supplier/buyer TIN
    if not structured["supplier"].get("Supplier's TIN"):
        issues.append("Missing Supplier's TIN")
    if not structured["buyer"].get("Buyer's TIN"):
        issues.append("Missing Buyer's TIN")

    # Validate totals if present
    totals = [float(item.get("Total Payable Amount", "0")) for item in structured["items"]]
    if totals and structured["invoice"].get("Invoice Currency Code") and sum(totals) <= 0:
        issues.append("Invoice totals look invalid")

    return {"ok": len(issues) == 0, "issues": issues}

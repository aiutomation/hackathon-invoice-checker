import json
from zlib import MAX_WBITS
import uvicorn
from fastapi import FastAPI
from fastapi import UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from pathlib import Path
from uuid import uuid4
from parse import aparse_file

from typing import List, Dict, Any
from pathlib import PurePath
import aiofiles


from invoice_runner import run_ie, generate_visualization_files, mandatory_fields

# Define the 33 mandatory e-invoice fields
SUPPLIER_FIELDS = [
    "Supplier's TIN",
    "Supplier's Registration / Identification Number / Passport Number",
    "Supplier's SST Registration Number [Mandatory for SST-registrant]",
    "Supplier's Tourism Tax Registration Number [Mandatory for tourism tax registrant]",
    "Supplier's Malaysia Standard Industrial Classification (MSIC) Code",
    "Supplier's Business Activity Description",
    "Supplier's Address",
    "Supplier's Contact Number",
]

BUYER_FIELDS = [
    "Buyer's TIN",
    "Buyer's Registration / Identification Number / Passport Number",
    "Buyer's SST Registration Number [Mandatory for SST-registrant]",
    "Buyer's Address",
    "Buyer's Contact Number",
]

INVOICE_FIELDS = [
    "e-Invoice Version",
    "e-Invoice Type",
    "e-Invoice Code / Number",
    "Original e-Invoice Reference Number [Mandatory, where applicable]",
    "e-Invoice Date and Time",
    "Issuer's Digital Signature",
    "Invoice Currency Code",
    "Currency Exchange Rate [Mandatory, where applicable]",
    "Supplier's Contact Number",
]

ITEM_COLUMNS = [
    "Classification",
    "Description of Product or Service",
    "Unit Price",
    "Tax Type",
    "Tax Rate [Mandatory, where applicable]",
    "Details of Tax Exemption [Mandatory if tax exemption is applicable]",
    "Amount Exempted from Tax [Mandatory if tax exemption is applicable]",
    "Subtotal",
    "Total Excluding Tax",
    "Total Including Tax",
    "Total Payable Amount",
    "Quantity",
    "Measurement",
]

ALL_MANDATORY_FIELDS = SUPPLIER_FIELDS + BUYER_FIELDS + INVOICE_FIELDS + ITEM_COLUMNS



def create_mandatory_fields_structure_simple(extractions):
    """
    Simple direct comparison approach: Compare extracted field names 
    directly with mandatory_fields from invoice_runner.py
    """
    # Debug: Print what we're working with
    print(f"DEBUG: Processing {len(extractions) if extractions else 0} extractions")
    
    # Collect extracted field names (extraction_class values)
    extracted_field_names = set()
    extracted_fields_map = {}
    
    if extractions:
        for extraction in extractions:
            if hasattr(extraction, 'extraction_class') and hasattr(extraction, 'extraction_text'):
                class_name = extraction.extraction_class
                text_value = extraction.extraction_text
                if class_name and text_value:
                    extracted_field_names.add(class_name)
                    extracted_fields_map[class_name] = {
                        "value": text_value,
                        "present": True
                    }
                    print(f"  Extracted: '{class_name}' = '{text_value}'")
    
    print(f"DEBUG: Total unique extracted fields: {len(extracted_field_names)}")
    print(f"DEBUG: Extracted field names: {list(extracted_field_names)}")
    print(f"DEBUG: Mandatory fields count: {len(mandatory_fields)}")
    
    # Create simple structure with all mandatory fields
    structured_data = {
        "mandatory_fields": {},
        "summary": {}
    }
    
    # Check each mandatory field against extracted fields (exact match only)
    fields_present = 0
    matched_fields = []
    
    for mandatory_field in mandatory_fields:
        is_present = mandatory_field in extracted_field_names
        if is_present:
            fields_present += 1
            matched_fields.append(mandatory_field)
            print(f"  MATCH: '{mandatory_field}' found in extractions")
            
        structured_data["mandatory_fields"][mandatory_field] = {
            "required": True,
            "present": is_present,
            "value": extracted_fields_map.get(mandatory_field, {}).get("value", None),
            "extracted_as": mandatory_field if is_present else None
        }
    
    print(f"DEBUG: Fields present: {fields_present}")
    print(f"DEBUG: Matched fields: {matched_fields}")
    
    # Add summary statistics
    total_fields = len(mandatory_fields)
    fields_missing = total_fields - fields_present
    completion_percentage = round((fields_present / total_fields) * 100, 2)
    
    structured_data["summary"] = {
        "total_mandatory_fields": total_fields,
        "fields_present": fields_present,
        "fields_missing": fields_missing,
        "completion_percentage": completion_percentage,
        "total_extracted_fields": len(extracted_field_names)  # Add this for frontend
    }
    
    print(f"DEBUG: Summary - Present: {fields_present}, Missing: {fields_missing}, Percentage: {completion_percentage}%")
    
    return structured_data

# Manual fallback functions removed - LLM-only approach for better accuracy


# Define base dirs once, reuse them everywhere
BASE_DIR = Path(__file__).parent
PDF_DIR = BASE_DIR / "pdf"
OUT_DIR = BASE_DIR / "output"

# Make sure they exist
PDF_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Self define max bytes limit
MAX_BYTES = 200 * 1024 * 1024  # 200 MB per file

app = FastAPI()

origins = ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/upload-pdf")
async def upload_pdf(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No file(s) provided")

    results: List[Dict[str, Any]] = []

    for file in files:
        if file.content_type not in ("application/pdf", "application/octet-stream"):
            results.append({"filename": file.filename, "error": "Not a PDF"})
            continue

        safe_name = PurePath(file.filename).name or "unnamed.pdf"
        unique_filename = f"{uuid4().hex}_{safe_name}"
        file_path = PDF_DIR / unique_filename

        written = 0
        try:
            async with aiofiles.open(file_path, "wb") as out_file:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_BYTES:
                        raise HTTPException(status_code=413, detail="File too large")
                    await out_file.write(chunk)
        except HTTPException as e:
            results.append({"filename": file.filename, "error": e.detail})
            continue
        except Exception as e:
            results.append(
                {"filename": file.filename, "error": f"Save error: {str(e)}"}
            )
            continue
        finally:
            await file.close()

        try:
            parsed = await aparse_file(str(file_path))

            # Pass parsed text to invoice_runner
            text_input = parsed.get("text") or parsed.get("markdown") or "\n\n".join(parsed.get("markdown_pages") or [])
            ie_result = None
            if text_input:
                try:
                    ie_result = run_ie(text_input)
                except Exception:
                    ie_result = None

            # Generate visualization files if we have results
            if ie_result is not None:
                try:
                    html = generate_visualization_files(ie_result, output_name_stem="invoice")
                    html_path = OUT_DIR / f"{unique_filename}.html"
                    async with aiofiles.open(html_path, "w", encoding="utf-8") as hf:
                        await hf.write(html if isinstance(html, str) else str(html))
                except Exception:
                    pass

            # Save parsed JSON
            output_path = OUT_DIR / f"{unique_filename}.json"
            async with aiofiles.open(output_path, "w", encoding="utf-8") as f:
                await f.write(json.dumps(parsed, ensure_ascii=False, indent=2))

            # Get extractions and create structured data
            extractions = []
            if ie_result:
                if isinstance(ie_result, dict):
                    extractions = ie_result.get("extractions", [])
                else:
                    extractions = getattr(ie_result, "extractions", [])
            
            # Simple direct comparison with mandatory_fields from invoice_runner.py
            mandatory_fields_structure = create_mandatory_fields_structure_simple(extractions)
            
            results.append(
                {
                    "filename": unique_filename,
                    "summary": f"Found {mandatory_fields_structure['summary']['fields_present']}/{mandatory_fields_structure['summary']['total_mandatory_fields']} mandatory fields ({mandatory_fields_structure['summary']['completion_percentage']}%)",
                    "markdown_pages": parsed.get("markdown_pages"),
                    "structured_data": mandatory_fields_structure,
                    "extractions": extractions,
                }
            )
        except Exception as e:
            # Cleanup uploaded file on parse failure
            try:
                file_path.unlink()
            except Exception:
                pass
            results.append(
                {"filename": unique_filename, "error": f"Parse error: {str(e)}"}
            )

    return {"results": results}


@app.get("/health")
async def health_check():
    """Simple health check endpoint"""
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
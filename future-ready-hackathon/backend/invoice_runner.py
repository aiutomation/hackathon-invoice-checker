import os
import textwrap
import langextract as lx

PROMPT = textwrap.dedent(
    """\
    Extract relevant fields from the invoice such as Supplier TIN, Supplier Registration Number, Supplier SST ID, Supplier MSIC code, Supplier business activity description, E-Invoice Type, E-Invoice Version, E-Invoice Code, Original Invoice Reference No., Invoice Date and Time, Buyer TIN, Buyer Contact Number, Buyer SST Registration ID, Buyer Registration Number, Buyer Address, Quantitiy, Unit Price,Tax Rate, Subtotal, Total excluding Tax, Total Including Tax, Total Payable Amount, Supplier Tourism Tax Registration Number, Supplier Address, Supplier Contact Number, Invoice Currency Code, Currency Exchange Rate, Digital Signature, Classification, Description of Product or Service, Tax Type, Details of Tax Exemption, Amount Exempted from Tax, Measurement.

    Strictly, Omit any empty values
    Strictly,Do not return duplicate classes or fields
    Strictly, Only return unique classes/fields once and do not repeat
"""
)
# total 33 fields
mandatory_fields = [
    "Supplier TIN",
    "Supplier Registration Number",
    "Supplier SST ID",
    "Supplier MSIC code",
    "Supplier business activity description",
    "E-Invoice Type",
    "E-Invoice Version",
    "E-Invoice Code",
    "Original Invoice Reference No.",
    "Invoice Date and Time",
    "Buyer TIN",
    "Buyer Contact Number",
    "Buyer SST Registration ID",
    "Buyer Registration Number",
    "Buyer Address",
    "Quantity",
    "Unit Price",
    "Tax Rate",
    "Subtotal",
    "Total excluding Tax",
    "Total Including Tax",
    "Total Payable Amount",
    "Supplier Tourism Tax Registration Number",
    "Supplier Address",
    "Supplier Contact Number",
    "Invoice Currency Code",
    "Currency Exchange Rate",
    "Digital Signature",
    "Classification",
    "Description of Product or Service",
    "Tax Type",
    "Details of Tax Exemption",
    "Amount Exempted from Tax",
    "Measurement",
]


EXAMPLES = [
    lx.data.ExampleData(
        text=textwrap.dedent(
            """\
            Hibiscus Mart Sdn Bhd
            Lot 66, Bangunan Merdeka, Persiaran Jaya, 50480, Kuala Lumpur
            60312346789
            hibiscus@mart.com

            Supplier TIN: C321456789120
            Supplier Registration Number: 660901111122
            Supplier SST ID: M10-123-45678901
            Supplier MSIC code: 47112
            Supplier business activity description: Supermarket

            E-INVOICE
            e-Invoice Type: 01 - Invoice
            e-Invoice version: 1.0
            e-Invoice code: INV00006
            Unique Identifier No: 123456789-2023-7654321
            Original Invoice Ref. No.: Not Applicable
            Invoice Date and Time: 2024-10-01 20:17:16

            Buyer TIN: EI00000000010
            Buyer Contact Number: NA
            Buyer SST Registration ID: NA
            Buyer Registration Number: NA
            Buyer Address: NA

            Classification | Description | Quantity | Unit Price | Amount | Disc | Tax Rate | Tax Amount | Total Price
            004 | 1110 - 1112 | 1 | RM 3,000.00 | RM 3,000.00 | - | - | - | RM 3,000.00
            004 | 1114 | 1 | RM 100.00 | RM 100.00 | - | - | - | RM 100.00
            004 | 1116 - 2450 | 1 | RM 34,900.00 | RM 34,900.00 | - | - | - | RM 34,900.00
            004 | 2452 - 2459 | 1 | RM 4,500.00 | RM 4,500.00 | - | - | - | RM 4,500.00
            004 | 2461 - 3107 | 1 | RM 22,250.00 | RM 22,250.00 | - | - | - | RM 22,250.00
            004 | 3109 - 3114 | 1 | RM 250.00 | RM 250.00 | - | - | - | RM 250.00

            Subtotal: RM 65,000.00
            Total excluding tax: RM 65,000.00
            Tax amount: RM 0.00
            Total including tax: RM 65,000.00
            Total payable amount: RM 65,000.00

            Digital Signature:
            8e83e05bbf9b5db17ac0deec3b7ce6cba983f6dc50531c7a91f28d5fb3696c3
        """
        ),
        extractions=[
            lx.data.Extraction("Supplier TIN", "C321456789120"),
            lx.data.Extraction("Supplier Registration Number", "660901111122"),
            lx.data.Extraction("Supplier SST ID", "M10-123-45678901"),
            lx.data.Extraction("Supplier MSIC code", "47112"),
            lx.data.Extraction("Supplier business activity description", "Supermarket"),
            lx.data.Extraction("E-Invoice Type", "01 - Invoice"),
            lx.data.Extraction("E-Invoice Version", "1.0"),
            lx.data.Extraction("E-Invoice Code", "INV-2024-0006"),
            lx.data.Extraction("Original Invoice Reference No.", "Not Applicable"),
            lx.data.Extraction("Invoice Date and Time", "2024-10-01 20:17:16"),
            lx.data.Extraction("Buyer TIN", "EI00000000010"),
            lx.data.Extraction("Buyer Contact Number", "+60 12-345 6789"),
            lx.data.Extraction("Buyer SST Registration ID", "1234567890"),
            lx.data.Extraction("Buyer Registration Number", "201901234567"),
            lx.data.Extraction(
                "Buyer Address", "No. 1, Jalan Kenanga, 50450 Kuala Lumpur"
            ),
            lx.data.Extraction("Quantity", "100"),
            lx.data.Extraction("Unit Price", "RM 650.00"),
            lx.data.Extraction("Subtotal", "RM 65,000.00"),
            lx.data.Extraction("Total excluding Tax", "RM 65,000.00"),
            lx.data.Extraction("Total Including Tax", "RM 65,000.00"),
            lx.data.Extraction("Total Payable Amount", "RM 65,000.00"),
            lx.data.Extraction(
                "Supplier Tourism Tax Registration Number", "128490284090"
            ),
            lx.data.Extraction(
                "Supplier Address",
                "Lot 66, Bangunan Merdeka, Persiaran Jaya, 50480 Kuala Lumpur",
            ),
            lx.data.Extraction("Supplier Contact Number", "+60 3-1234 5678"),
            lx.data.Extraction("Invoice Currency Code", "MYR"),
            lx.data.Extraction("Currency Exchange Rate", "1.0000"),
            lx.data.Extraction(
                "Digital Signature",
                "8e83e05bbf9b5db17ac0deec3b7ce6cba983f6dc50531c7a919f28d5fb3696c3",
            ),
            lx.data.Extraction("Classification", "Goods"),
            lx.data.Extraction(
                "Description of Product or Service", "Retail display shelves"
            ),
            lx.data.Extraction("Tax Type", "SST-Exempt"),
            lx.data.Extraction("Tax Rate", "0%"),
            lx.data.Extraction("Details of Tax Exemption", "Exempt supply (Schedule)"),
            lx.data.Extraction("Amount Exempted from Tax", "RM 65,000.00"),
            lx.data.Extraction("Measurement", "pcs"),
        ],
    )
]


def run_ie(text):
    return lx.extract(
        text_or_documents=text,
        prompt_description=PROMPT,
        examples=EXAMPLES,
        model_id="gemini-2.5-flash",
        # model_id="gemini-2.5-pro",
        # model_id="gpt-4o",
        # api_key=os.environ.get("OPENAI_API_KEY"),
        # fence_output=True,
        # use_schema_constraints=False,
    )


def generate_visualization_files(result, output_name_stem: str) -> str:
    """
    Save annotated JSONL into the default `test_output/` folder and
    return the HTML visualization string.

    - JSONL path will be: test_output/{output_name_stem}.jsonl
    - Returned HTML can be written by the caller to any desired location.
    """
    try:
        lx.io.save_annotated_documents(
            [result], output_name=f"{output_name_stem}.jsonl"
        )
        html = lx.visualize(f"test_output/{output_name_stem}.jsonl")
        return html
    except Exception as e:
        return f"Failed to generate visualization: {str(e)}"

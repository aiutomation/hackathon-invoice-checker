# parse.py
from llama_cloud_services import LlamaParse
from dotenv import load_dotenv
import os

load_dotenv()

parser = LlamaParse(
    api_key=os.getenv("LLAMA_CLOUD_API_KEY"),
    num_workers=4,
    verbose=True,
    language="en",
    # Keep tables as Markdown so we don't need rehypeRaw on the frontend
    output_tables_as_HTML=False,
    premium_mode=True,
    extract_structured_data=True,
    adaptive_long_table=True,
    outlined_table_extraction=True,
)

async def aparse_file(pdf_path: str) -> dict:
    """Async version of parse_file"""
    try:
        result = await parser.aparse(pdf_path)

        # text
        text_docs = result.get_text_documents(split_by_page=False)
        text_content = text_docs[0].text if text_docs else ""

        markdown_pages = []
        structured_data = []

        if hasattr(result, "pages") and result.pages:
            for page in result.pages:
                if hasattr(page, "md") and page.md:
                    markdown_pages.append(page.md)
                if hasattr(page, "structuredData") and page.structuredData:
                    structured_data.append(page.structuredData)

        # Join page Markdown with a clear separator
        markdown = "\n\n---\n\n".join(markdown_pages) if markdown_pages else text_content

        return {
            "text": text_content,
            "markdown": markdown,               # <— single markdown string
            "markdown_pages": markdown_pages,
            "structured_data": structured_data,
        }
    except Exception as e:
        print(f"Error parsing PDF: {str(e)}")
        return {
            "text": "",
            "markdown": "",
            "markdown_pages": [],
            "structured_data": [],
            "error": str(e),
        }


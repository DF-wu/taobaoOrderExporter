"""Independent, standard-library OOXML verification. Never needs real customer data."""
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    for name in archive.namelist():
        ET.fromstring(archive.read(name))
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    assert [s.attrib["name"] for s in workbook.findall("s:sheets/s:sheet", NS)] == ["Orders", "Items", "Packages", "Errors", "Metadata"]
    rows = []
    for sheet in range(1, 6):
        root = ET.fromstring(archive.read(f"xl/worksheets/sheet{sheet}.xml"))
        assert not root.findall(".//s:f", NS)
        for cell in root.findall(".//s:c", NS):
            assert cell.attrib["t"] == "inlineStr"
        rows.append([[cell.find("s:is/s:t", NS).text or "" for cell in row] for row in root.findall("s:sheetData/s:row", NS)])
    assert rows[0][1][0] == "9007199254740993123"
    assert len(rows[0]) == 2 and len(rows[1]) == 3 and len(rows[2]) == 3
    assert rows[2][1][3] == "001234567890123456789"
    assert rows[1][1][3] == '=HYPERLINK("https://invalid.example") 中文<&>'
print("XLSX ZIP, XML, sheet structure, text IDs and formula safety verified")

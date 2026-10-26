"""Synthetic workbook checks for the predeclaration input reader."""
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / 'skills/shengtian-predeclare/scripts/read_export.py'
SPEC = importlib.util.spec_from_file_location('read_export', MODULE)
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


def workbook(filename, cells, shared=''):
    with zipfile.ZipFile(filename, 'w') as archive:
        archive.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Example" r:id="rId1"/></sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + cells + '</sheetData></worksheet>')
        if shared:
            archive.writestr('xl/sharedStrings.xml', shared)


HEADERS = '<row><c r="A1" t="inlineStr"><is><t>ID</t></is></c><c r="B1" t="inlineStr"><is><t>Blank</t></is></c><c r="C1" t="inlineStr"><is><t>Tracking</t></is></c></row>'


class ReaderTests(unittest.TestCase):
    def test_sparse_cells_preserve_alignment_and_exact_identifiers(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'source.xlsx'
            workbook(target, HEADERS + '<row><c r="A2" t="inlineStr"><is><t>9000000000000000001</t></is></c><c r="C2" t="inlineStr"><is><t>001234567890</t></is></c></row>')
            self.assertEqual(reader.read_sheets(target)['Example'], [{'ID': '9000000000000000001', 'Blank': '', 'Tracking': '001234567890'}])

    def test_shared_strings_and_rich_text(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'source.xlsx'
            workbook(target, HEADERS + '<row><c r="A2" t="s"><v>0</v></c></row>', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>9000000000</t></r><r><t>000000001</t></r></si></sst>')
            self.assertEqual(reader.read_sheets(target)['Example'][0]['ID'], '9000000000000000001')

    def test_unexpected_formulas_fail_instead_of_using_cached_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'source.xlsx'
            workbook(target, HEADERS + '<row><c r="A2"><f>1+1</f><v>2</v></c></row>')
            with self.assertRaisesRegex(ValueError, 'formula'):
                reader.read_sheets(target)


if __name__ == '__main__':
    unittest.main()

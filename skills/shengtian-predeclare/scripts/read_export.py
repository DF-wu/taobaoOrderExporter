"""Read the exporter's XLSX without Excel or third party dependencies.

Identifiers stay strings. Sparse cells are aligned by their XML column refs.
This reads the source only and emits the same nested order shape as JSON export.
"""
import argparse
import json
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

MAIN = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def column_index(reference):
    value = 0
    for letter in re.match(r'[A-Z]+', reference).group():
        value = value * 26 + ord(letter) - ord('A') + 1
    return value - 1


def read_sheets(filename):
    with zipfile.ZipFile(filename) as archive:
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(e.itertext()) for e in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        relationships = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        sheets = {}
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).find(MAIN + 'sheets'):
            target = relationships[sheet.attrib[REL + 'id']]
            target = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
            rows = []
            for row in ET.fromstring(archive.read(target)).find(MAIN + 'sheetData'):
                values = []
                for cell in row:
                    index = column_index(cell.attrib['r'])
                    values.extend([''] * (index + 1 - len(values)))
                    if cell.find(MAIN + 'f') is not None:
                        raise ValueError('Unexpected formula in source export; use the original exporter file')
                    value = cell.findtext(MAIN + 'v', '')
                    if cell.attrib.get('t') == 'inlineStr':
                        value = ''.join(cell.find(MAIN + 'is').itertext())
                    elif cell.attrib.get('t') == 's':
                        value = shared[int(value)]
                    values[index] = value
                rows.append(values)
            if not rows:
                raise ValueError(f'Empty sheet: {sheet.attrib["name"]}')
            headers = rows[0]
            if len(set(headers)) != len(headers):
                raise ValueError('Duplicate spreadsheet headers')
            sheets[sheet.attrib['name']] = [dict(zip(headers, row + [''] * (len(headers) - len(row)))) for row in rows[1:]]
        return sheets


def convert(filename):
    sheets = read_sheets(filename)
    orders = {}
    for row in sheets['Orders']:
        order_id = row['主訂單號']
        if not re.fullmatch(r'\d+', order_id) or order_id in orders:
            raise ValueError('Invalid or duplicate order ID')
        orders[order_id] = dict(orderId=order_id, createdAt=row['購買時間'], shopName=row['店舖'],
                                status=row['訂單狀態'], logisticsStatus=row['物流狀態'],
                                logisticsError=row.get('物流錯誤', ''), items=[], packages=[])
    for row in sheets['Items']:
        orders[row['主訂單號']]['items'].append(dict(subOrderId=row['子訂單號'], title=row['商品名稱'],
            sku=row['規格'], quantity=row['數量'], refundStatus=row['退款狀態']))
    for row in sheets['Packages']:
        orders[row['主訂單號']]['packages'].append(dict(trackingNumber=row['物流單號'], company=row['物流公司'],
            subOrderIds=json.loads(row['對應子訂單號（JSON）'] or '[]'), goods=json.loads(row.get('包裹商品描述（JSON）') or '[]')))
    return dict(schemaVersion=1, orders=list(orders.values()), errors=sheets.get('Errors', []))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input')
    parser.add_argument('output')
    args = parser.parse_args()
    result = convert(args.input)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Read {len(result["orders"])} orders; output saved locally.')

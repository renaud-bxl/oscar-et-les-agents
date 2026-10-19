"""Public synthetic fixtures for the document feature; no personal data."""
import datetime
import json
import os
import sys
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from reportlab.pdfgen import canvas

folder = sys.argv[1]
os.makedirs(folder, exist_ok=True)
document = Document()
document.core_properties.created = datetime.datetime(2020, 1, 1)
document.core_properties.modified = datetime.datetime(2020, 1, 1)
section = document.sections[0]
section.header.paragraphs[0].text = 'Commission des projets locaux — modèle public'
document.add_heading('Note parlementaire de démonstration', 0)
paragraph = document.add_paragraph('Référence publique — couleurs à conserver')
paragraph.runs[0].font.color.rgb = RGBColor.from_string('9B6B22')
paragraph.runs[0].bold = True
marker = document.add_paragraph()
marker.paragraph_format.space_after = Pt(8)
first = marker.add_run('{{CON'); first.font.color.rgb = RGBColor.from_string('255C49')
marker.add_run('TENU}}').font.color.rgb = RGBColor.from_string('255C49')
document.add_paragraph('Fin du modèle — zone conservée.')
document.save(os.path.join(folder, 'Modele parlementaire.docx'))
table_document = Document()
table_document.sections[0].header.paragraphs[0].text = 'Parlement — modèle public avec tableau'
table_document.sections[0].footer.paragraphs[0].text = 'Document de démonstration — sans données personnelles'
table_document.add_heading('Interpellation parlementaire', 0)
table = table_document.add_table(rows=2, cols=2)
table.style = 'Table Grid'
table.autofit = False
table.columns[0].width = Cm(6)
table.columns[1].width = Cm(10)
table.cell(0, 0).text = 'Sujet'
table.cell(0, 1).text = 'Mobilité et écoles'
table.cell(1, 0).text = 'Texte de la question'
cell = table.cell(1, 1)
cell.width = Cm(10)
first = cell.paragraphs[0].add_run('{{CON')
first.font.color.rgb = RGBColor.from_string('255C49')
cell.paragraphs[0].add_run('TENU}}').font.color.rgb = RGBColor.from_string('255C49')
fill = OxmlElement('w:shd'); fill.set(qn('w:fill'), 'EAD7AC'); table.cell(0, 0)._tc.get_or_add_tcPr().append(fill)
link = OxmlElement('w:hyperlink')
link.set(qn('r:id'), table_document.part.relate_to('https://www.parlement.brussels/documents/?q=ecoles&annee=2026', RELATIONSHIP_TYPE.HYPERLINK, is_external=True))
run = OxmlElement('w:r'); text = OxmlElement('w:t'); text.text = 'Source parlementaire publique'; run.append(text); link.append(run)
table_document.add_paragraph()._p.append(link)
table_document.save(os.path.join(folder, 'Modele parlementaire tableau.docx'))
workbook = Workbook(); sheet = workbook.active; sheet.title = 'Budget original'
sheet.append(['Projet', 'Quantité', 'Prix', 'Total'])
sheet.append(['Bibliothèque', 3, 12, '=B2*C2'])
for cell in sheet[1]:
    cell.fill = PatternFill('solid', fgColor='D9B35E'); cell.font = Font(color='243B2F', bold=True)
sheet['A2'].fill = PatternFill('solid', fgColor='E2ECDD')
sheet.column_dimensions['A'].width = 30
sheet.freeze_panes = 'A2'
workbook.save(os.path.join(folder, 'Modele budget.xlsx'))
pdf = canvas.Canvas(os.path.join(folder, 'Exemple visuel.pdf'), invariant=1)
pdf.setFillColorRGB(.15, .35, .28); pdf.setFont('Helvetica-Bold', 24); pdf.drawString(60, 770, 'Exemple public')
pdf.setFillColorRGB(.55, .4, .15); pdf.setFont('Helvetica', 12); pdf.drawString(60, 730, 'Une référence visuelle, sans données personnelles.')
pdf.save()
print(json.dumps({'files': ['Modele parlementaire.docx', 'Modele budget.xlsx', 'Exemple visuel.pdf']}))

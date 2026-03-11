'use client';

import { useState, useEffect } from 'react';
import { PDFViewer, Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import logo from '@/public/logo-evalua.png';

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.4 },
  title: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  section: { marginTop: 12, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  text: { fontSize: 10, lineHeight: 1.5 },
});

interface Props {
  nombreEstudiante?: string;
  puntaje: string;
  nota: string | number;
  retroalimentacion: any;
  areaConocimiento: string;
  usedAnswerKeyTemplate?: boolean; // Indica si se uso la plantilla del profesor
}

// 🔥 CORRECCIÓN: elimina caracteres que causan superposición
const clean = (t: any) => {
  if (!t) return '—';
  return String(t)
    .replace(/[\x00-\x1F\x7F]/g, '') // elimina ASCII 0-31 y 127
    .replace(/\s+/g, ' ')
    .trim() || '—';
};

export default function EvaluacionPDF({
  nombreEstudiante,
  puntaje,
  nota,
  retroalimentacion,
  areaConocimiento,
  usedAnswerKeyTemplate,
}: Props) {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);

  if (!isClient) return <div>Cargando...</div>;

  const f = clean(retroalimentacion?.resumen_general?.fortalezas);
  const a = clean(retroalimentacion?.resumen_general?.areas_mejora);

  return (
    <div className="w-full h-[80vh] border rounded">
      <PDFViewer width="100%" height="100%">
        <Document>
          <Page size="A4" style={styles.page}>
            <Text style={styles.title}>
              {nombreEstudiante || 'Informe de Evaluación'}
            </Text>

<View style={styles.section}>
              <Text><Text style={{ fontWeight: 'bold' }}>Puntaje:</Text> {puntaje}</Text>
              <Text><Text style={{ fontWeight: 'bold' }}>Nota:</Text> {nota}</Text>
              <Text><Text style={{ fontWeight: 'bold' }}>Área:</Text> {areaConocimiento}</Text>
              {usedAnswerKeyTemplate && (
                <Text style={{ color: '#16a34a', fontSize: 9, marginTop: 4 }}>
                  Alternativas corregidas con Plantilla del Profesor (100% precision)
                </Text>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Fortalezas</Text>
              <Text style={styles.text}>{f}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>Áreas de mejora</Text>
              <Text style={styles.text}>{a}</Text>
            </View>
          </Page>
        </Document>
      </PDFViewer>
    </div>
  );
}
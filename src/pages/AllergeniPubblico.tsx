import { useEffect, useState } from 'react';
import { ALLERGEN_LIST, ServedProduct, decodeProductsFromUrl } from '@/store/allergenProductsStore';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { AlertTriangle, RefreshCw, Printer } from 'lucide-react';

export default function AllergeniPubblico() {
  const [products, setProducts] = useState<ServedProduct[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    const decoded = decodeProductsFromUrl();
    if (decoded.length > 0) {
      setProducts(decoded);
    } else {
      setError(true);
    }
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-6 pb-6">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Tabella non disponibile</h1>
            <p className="text-muted-foreground text-sm">
              La tabella allergeni non è stata trovata o il link non è valido.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-400 mx-auto mb-3" />
          <p className="text-muted-foreground">Caricamento tabella allergeni...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="text-center mb-4 print:mb-2 relative">
          <button
            onClick={() => window.print()}
            className="print:hidden absolute right-0 top-0 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 text-gray-700"
          >
            <Printer className="h-4 w-4" />
            Stampa
          </button>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            Tabella Allergeni
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Prodotti somministrati - Reg. UE 1169/2011
          </p>
        </div>

        {/* Tabella */}
        <div className="bg-white rounded-lg shadow border overflow-hidden print:shadow-none print:border-gray-300">
          <div className="overflow-x-auto">
            <Table className="border-collapse text-xs sm:text-sm">
              <TableHeader>
                <TableRow className="bg-gray-800 text-white">
                  <TableHead className="border border-gray-600 text-center font-bold py-2 px-1.5 w-10 print:w-8">
                    N.
                  </TableHead>
                  <TableHead className="border border-gray-600 text-left font-bold py-2 px-2 min-w-[160px]">
                    Prodotto / Piatto
                  </TableHead>
                  {ALLERGEN_LIST.map(a => (
                    <TableHead
                      key={a.id}
                      className="border border-gray-600 text-center font-bold py-1 px-1 w-[52px] min-w-[52px] print:w-10 print:min-w-0"
                      title={`${a.numero}. ${a.nome} - ${a.dettaglio}`}
                    >
                      <div className="leading-tight">{a.numero}</div>
                      <div className="text-[9px] font-medium leading-tight whitespace-normal">
                        {a.breve}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((prod, idx) => (
                  <TableRow key={prod.id} className={idx % 2 === 1 ? 'bg-gray-50' : ''}>
                    <TableCell className="border text-center py-2 px-1.5 font-bold">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="border py-2 px-2 font-medium">
                      {prod.nome}
                      {prod.descrizione && (
                        <div className="text-[10px] text-muted-foreground font-normal">
                          {prod.descrizione}
                        </div>
                      )}
                    </TableCell>
                    {ALLERGEN_LIST.map(a => (
                      <TableCell
                        key={a.id}
                        className={`border text-center py-2 px-1 font-bold ${
                          prod.allergeni.includes(a.id)
                            ? 'bg-red-500 text-white'
                            : 'text-gray-300'
                        }`}
                      >
                        {prod.allergeni.includes(a.id) ? '✓' : '·'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Legenda */}
        <div className="mt-4 bg-white rounded-lg shadow border p-4 print:shadow-none">
          <h2 className="font-bold text-sm sm:text-base mb-3">
            Legenda Allergeni (Reg. UE 1169/2011)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs sm:text-sm">
            {ALLERGEN_LIST.map(a => (
              <div key={a.id} className="flex gap-2 items-start">
                <Badge variant="outline" className="shrink-0 font-bold text-xs">
                  {a.numero}
                </Badge>
                <div>
                  <span className="font-semibold">{a.nome}</span>
                  <span className="text-muted-foreground"> - {a.dettaglio}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4 print:hidden">
          Ultimo aggiornamento:{' '}
          {new Date().toLocaleDateString('it-IT', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
          })}
        </p>
      </div>
    </div>
  );
}

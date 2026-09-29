import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Política de privacidad · AndyOS' };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6 leading-relaxed">
      <h1 className="text-2xl font-semibold">Política de privacidad</h1>
      <p className="text-sm text-zinc-400">Última actualización: 29 de septiembre de 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Qué es esta aplicación</h2>
        <p>
          «AndyOS respaldo» es una aplicación de uso personal y privado de Andrés Gómez. No se ofrece al público ni
          tiene otros usuarios: la única cuenta de Google que la autoriza es la de su propietario.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Qué datos de Google usa y para qué</h2>
        <p>
          Se conecta a Google Drive de su propietario, a través de una instancia propia de n8n, únicamente para
          subir archivos de copia de seguridad de su propio sistema de gestión de contenido. No lee, comparte ni
          publica el contenido de otras personas.
        </p>
        <p>
          El uso y la transferencia de la información recibida de las API de Google se ajustan a la{' '}
          <a className="text-orange-400 underline" href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer">
            Política de datos de usuario de los servicios de API de Google
          </a>
          , incluidos los requisitos de uso limitado.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Con quién se comparten</h2>
        <p>Con nadie. No se venden, alquilan ni ceden datos a terceros, y no se usan para publicidad ni para entrenar modelos de IA.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Almacenamiento y revocación</h2>
        <p>
          Las credenciales de acceso se guardan cifradas en la instancia n8n del propietario. Puede revocar el acceso
          en cualquier momento desde{' '}
          <a className="text-orange-400 underline" href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
            myaccount.google.com/permissions
          </a>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Contacto</h2>
        <p>Andrés Gómez · agomez87@gmail.com</p>
      </section>
    </main>
  );
}

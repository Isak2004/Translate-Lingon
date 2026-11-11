import { Link, useNavigate } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';

// Användarguide: hur en text går runt mellan PDH och Translate, och varför
// import, AI-granskning och "Skicka till PDH" inte kan förstöra något.

export function Guide() {
  const navigate = useNavigate();

  return (
    <div className="guide-layout">
      <div className="guide-topbar">
        <button className="back-link" onClick={() => navigate(-1)} title="Tillbaka">
          ←
        </button>
        <span className="brand">Så fungerar Translate</span>
        <div className="topbar-spacer" />
        <ThemeToggle />
      </div>

      <div className="guide-content">
        <section>
          <h2>Gör så här</h2>
          <ol className="guide-routine">
            <li>Öppna projektet. Nya texter hämtas automatiskt.</li>
          </ol>

          <h3>Enstaka texter</h3>
          <ol className="guide-routine" start={2}>
            <li>Använd sökfunktionen för att hitta din text.</li>
            <li>Ändra och spara texten.</li>
            <li>Klicka <b>Skicka till PDH</b>. Kolla listan du får och tryck <b>Skicka</b>.</li>
          </ol>

          <h3>Ett större antal texter</h3>
          <ol className="guide-routine" start={2}>
            <li>
              Klicka <b>Granska med AI</b>. AI:n kollar om den hittar någon översättning
              som verkar fel. Bara nya och ändrade texter granskas.
            </li>
            <li>Gå igenom filtren <b>Ej godkänd</b> och <b>Engelska ändrad</b>. Rätta eller godkänn.</li>
            <li><b>Skicka till PDH</b>. Läs igenom listan och tryck <b>Skicka</b>.</li>
          </ol>

          <p>Dina ändringar kommer in i PDH vid nästa uppdatering.</p>
        </section>

        <section className="guide-answer">
          <h2>Kan jag förstöra något?</h2>
          <p className="guide-lead">
            Nej, inte genom att hämta från PDH, AI-granska eller skicka till PDH. Alla
            tre går att köra hur många gånger som helst.
          </p>
          <ul>
            <li>
              <b>Hämtningen från PDH</b> skriver aldrig över texter du har ändrat. Den sker
              av sig själv varje gång du öppnar ett projekt.
            </li>
            <li>
              <b>Granska med AI</b> ändrar aldrig någon text. Den flaggar bara texter
              och föreslår förbättringar som du själv väljer om du vill använda.
            </li>
            <li>
              <b>Skicka till PDH</b> ändrar ingenting i Translate, och inget går live
              direkt. Texterna hamnar i en pull request som en utvecklare granskar
              och godkänner i PDH. Du ser alla texter innan du skickar och kan avbryta.
            </li>
          </ul>
          <p>
            Det enda som tar bort en ändring du gjort är knappen <b>Använd PDH:s text</b>.
            Även då finns din gamla text kvar i historiken (🕑 på raden).
          </p>
        </section>

        <section className="guide-key">
          <h2>Det viktigaste att förstå</h2>
          <p className="guide-lead">
            En text räknas som <b>ändrad</b> så länge din svenska skiljer sig från PDH:s
            svenska vid senaste hämtningen.
          </p>
          <p>
            Translate minns hur varje svensk text såg ut när den senast hämtades från
            PDH. Allt annat följer av det:
          </p>
          <ul>
            <li><b>Skicka till PDH</b> skickar alla ändrade texter, varje gång.</li>
            <li>Att skicka, AI-granska eller godkänna gör inte att en text slutar vara ändrad.</li>
          </ul>
        </section>

        <section>
          <h2>En texts rundtur</h2>
          <ol className="guide-cycle">
            <li>
              <span className="guide-step">Öppna projektet</span>
              Translate hämtar de senaste texterna från PDH (engelskan och projektets
              språk). Det är startpunkten, och det sker varje gång du öppnar projektet.
            </li>
            <li>
              <span className="guide-step">Ändra</span>
              Du rättar en svensk text och sparar. Den skiljer sig nu från PDH:s och
              räknas som ändrad (filtret <b>Ändrade</b>).
            </li>
            <li>
              <span className="guide-step">Skicka till PDH</span>
              Alla ändrade texter skickas. I PDH blir det en pull request, och en
              tidigare öppen pull request från Translate ersätts av den nya. I Translate
              händer ingenting: texterna räknas fortfarande som ändrade.
            </li>
            <li>
              <span className="guide-step">Utvecklaren godkänner</span>
              En utvecklare granskar och godkänner (mergar) pull requesten. Först nu
              finns dina texter i PDH.
            </li>
            <li>
              <span className="guide-step">Öppna projektet igen</span>
              Nästa hämtning innehåller dina texter, eftersom de nu finns i PDH. PDH:s
              text och din är likadana, så de räknas inte längre som ändrade.
              Rundturen är klar.
            </li>
          </ol>
          <p>
            Öppnar du projektet innan utvecklaren har godkänt ligger dina texter kvar som
            ändrade och skickas med nästa gång. Det är ofarligt: en text som redan finns
            i PDH skickas inte igen.
          </p>
        </section>

        <section>
          <h2>Vad knapparna gör</h2>
          <table className="guide-table">
            <tbody>
              <tr>
                <th>Hämta igen</th>
                <td>
                  Hämtar de senaste texterna från PDH: engelskan och projektets språk.
                  Sker av sig själv när du öppnar ett projekt, men här kan du göra det
                  när du vill och se vad som händer innan något sparas. Lägger till nya
                  texter och uppdaterar engelska och svenska. Svenska du har ändrat
                  behålls. Om en engelsk text har ändrats görs AI-granskningen om för
                  den. Tar aldrig bort texter.
                </td>
              </tr>
              <tr>
                <th>Granska med AI</th>
                <td>
                  Granskar texter som inte har granskats sedan de senast ändrades i
                  PDH. Ändrar ingen text. Kostar pengar per körning, så kör den när det
                  finns nytt att granska. Misslyckas en del, kör den igen; den tar då
                  bara det som inte hann granskas.
                </td>
              </tr>
              <tr>
                <th>Spara (💾)</th>
                <td>Sparar din text. Den räknas som ändrad och som manuellt godkänd.</td>
              </tr>
              <tr>
                <th>Godkänn manuellt (rutan före nyckeln)</th>
                <td>Säger att texten är rätt fast AI:n flaggade den. Ändrar inte texten.</td>
              </tr>
              <tr>
                <th>Behåll min text</th>
                <td>
                  Visas när engelskan har ändrats efter att du ändrade eller godkände
                  svenskan. Säger att din svenska fortfarande stämmer.
                </td>
              </tr>
              <tr>
                <th>Använd PDH:s text</th>
                <td>Tar bort din ändring och går tillbaka till PDH:s svenska. Din text finns kvar i historiken.</td>
              </tr>
              <tr>
                <th>Skicka till PDH</th>
                <td>
                  Kontrollerar alla ändrade texter mot PDH och visar vad som skickas, vad
                  som stoppas och vad som redan finns där. Efter bekräftelse skapas en
                  pull request. Ändrar ingenting i Translate. Skickar du igen ersätter
                  den nya pull requesten den förra och innehåller alla ändringar sedan
                  senaste hämtningen.
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>Vanliga frågor</h2>
          <dl className="guide-faq">
            <dt>Jag har skickat, men texterna står fortfarande som ändrade.</dt>
            <dd>
              Det är rätt. De räknas som ändrade tills utvecklaren har godkänt i PDH och
              du har öppnat projektet igen.
            </dd>

            <dt>Vilka texter skickas?</dt>
            <dd>
              Alla texter där din svenska skiljer sig från PDH:s vid senaste hämtningen.
              Tomma texter och texter under <b>Engelska ändrad</b> hålls tillbaka tills du
              har tittat på dem. Du ser hela listan innan du skickar, och under{' '}
              <b>Stoppas</b> står varför en text inte kan skickas.
            </dd>

            <dt>Utvecklaren säger att pull requesten har en konflikt.</dt>
            <dd>
              Det betyder att någon i PDH har ändrat samma text, eller texten på raden
              intill, medan pull requesten låg öppen. Tryck <b>Skicka till PDH</b> igen.
              Då skapas en ny pull request från PDH:s senaste version och den gamla stängs.
            </dd>

            <dt>Vad betyder "Ej granskad"?</dt>
            <dd>
              AI:n har inte granskat texten än. Det gäller nya texter från PDH, och texter
              som har ändrats i PDH sedan de granskades (då gäller ett tidigare godkännande
              inte längre). Kör <b>Granska med AI</b>, så hamnar de under{' '}
              <b>AI-godkänd</b> eller <b>Ej godkänd</b>. En ogranskad text räknas aldrig
              som godkänd, men du kan godkänna den manuellt direkt.
            </dd>

            <dt>Vad betyder "Engelska ändrad"?</dt>
            <dd>
              Engelskan har ändrats i PDH efter att du ändrade eller godkände den svenska
              texten. Kontrollera att svenskan fortfarande stämmer och välj{' '}
              <b>Behåll min text</b> eller <b>Använd PDH:s text</b>.
            </dd>

            <dt>Någon har ändrat samma svenska text direkt i PDH. Vems text gäller?</dt>
            <dd>
              Din, när du skickar. I listan ser du PDH:s aktuella text under <b>Före</b>,
              och en varning om den har ändrats sedan senaste hämtningen.
            </dd>

            <dt>Utvecklaren justerade min text innan den godkändes. Vad händer?</dt>
            <dd>
              Då är PDH:s text varken din eller den gamla. Vid nästa hämtning behålls din
              version och texten räknas fortfarande som ändrad (det står som "din ändring
              behålls"). Skickar du igen skriver din version över
              utvecklarens. Vill du ha utvecklarens version: tryck <b>Återställ</b> vid
              "Vid import" på sidan <b>Granska ändrade</b>.
            </dd>

            <dt>En text har tagits bort i PDH men finns kvar i Translate.</dt>
            <dd>
              Hämtningen tar aldrig bort texter. Den ligger kvar men gör ingen skada. Är
              den ändrad stoppas den när du skickar, och listan visar varför.
            </dd>

            <dt>Kan jag hämta fel språk?</dt>
            <dd>
              Nej. Varje projekt har ett språk som väljs när projektet skapas och inte
              kan ändras. Hämtning och <b>Skicka till PDH</b> använder alltid det språket.
              Vill du översätta till ett nytt språk skapar du ett nytt projekt.
            </dd>

            <dt>Jag valde fel filer själv under Hämta igen.</dt>
            <dd>
              Gäller bara om du har valt filer själv i stället för att hämta från PDH.
              Då varnar Translate om filerna verkar ha bytt plats (och stoppar då) eller
              saknar många texter. Har du ändå importerat fel: tryck <b>Hämta från PDH</b>.
              Dina egna ändringar har inte rörts, men AI-granskningen kan behöva köras om
              för texter vars engelska ändrades.
            </dd>
          </dl>
        </section>

        <p className="guide-footer">
          <Link to="/">Till projekten</Link>
        </p>
      </div>
    </div>
  );
}

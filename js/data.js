'use strict';
// Static game data: the city network, roles, and event cards.
// Descriptions are original text; mechanics follow the standard base game.

(function () {
  const cities = [
    // ---- Blue ----
    { name: 'San Francisco', color: 'blue', x: 120, y: 270, adj: ['Tokyo', 'Manila', 'Los Angeles', 'Chicago'] },
    { name: 'Chicago', color: 'blue', x: 235, y: 248, adj: ['San Francisco', 'Los Angeles', 'Mexico City', 'Atlanta', 'Montreal'] },
    { name: 'Atlanta', color: 'blue', x: 268, y: 312, adj: ['Chicago', 'Washington', 'Miami'] },
    { name: 'Montreal', color: 'blue', x: 330, y: 232, adj: ['Chicago', 'Washington', 'New York'] },
    { name: 'New York', color: 'blue', x: 392, y: 262, adj: ['Montreal', 'Washington', 'London', 'Madrid'] },
    { name: 'Washington', color: 'blue', x: 352, y: 305, adj: ['Atlanta', 'Montreal', 'New York', 'Miami'] },
    { name: 'London', color: 'blue', x: 645, y: 192, adj: ['New York', 'Madrid', 'Paris', 'Essen'] },
    { name: 'Madrid', color: 'blue', x: 635, y: 278, adj: ['New York', 'London', 'Paris', 'Algiers', 'Sao Paulo'] },
    { name: 'Paris', color: 'blue', x: 705, y: 232, adj: ['London', 'Madrid', 'Essen', 'Milan', 'Algiers'] },
    { name: 'Essen', color: 'blue', x: 735, y: 182, adj: ['London', 'Paris', 'Milan', 'St. Petersburg'] },
    { name: 'Milan', color: 'blue', x: 760, y: 238, adj: ['Essen', 'Paris', 'Istanbul'] },
    { name: 'St. Petersburg', color: 'blue', x: 815, y: 152, adj: ['Essen', 'Istanbul', 'Moscow'] },
    // ---- Yellow ----
    { name: 'Los Angeles', color: 'yellow', x: 128, y: 338, adj: ['San Francisco', 'Chicago', 'Mexico City', 'Sydney'] },
    { name: 'Mexico City', color: 'yellow', x: 215, y: 388, adj: ['Los Angeles', 'Chicago', 'Miami', 'Bogota', 'Lima'] },
    { name: 'Miami', color: 'yellow', x: 318, y: 372, adj: ['Atlanta', 'Washington', 'Mexico City', 'Bogota'] },
    { name: 'Bogota', color: 'yellow', x: 305, y: 452, adj: ['Miami', 'Mexico City', 'Lima', 'Buenos Aires', 'Sao Paulo'] },
    { name: 'Lima', color: 'yellow', x: 290, y: 530, adj: ['Mexico City', 'Bogota', 'Santiago'] },
    { name: 'Santiago', color: 'yellow', x: 305, y: 618, adj: ['Lima'] },
    { name: 'Buenos Aires', color: 'yellow', x: 390, y: 612, adj: ['Bogota', 'Sao Paulo'] },
    { name: 'Sao Paulo', color: 'yellow', x: 432, y: 540, adj: ['Bogota', 'Buenos Aires', 'Madrid', 'Lagos'] },
    { name: 'Lagos', color: 'yellow', x: 690, y: 448, adj: ['Sao Paulo', 'Kinshasa', 'Khartoum'] },
    { name: 'Kinshasa', color: 'yellow', x: 752, y: 505, adj: ['Lagos', 'Khartoum', 'Johannesburg'] },
    { name: 'Johannesburg', color: 'yellow', x: 795, y: 588, adj: ['Kinshasa', 'Khartoum'] },
    { name: 'Khartoum', color: 'yellow', x: 800, y: 425, adj: ['Lagos', 'Kinshasa', 'Johannesburg', 'Cairo'] },
    // ---- Black ----
    { name: 'Algiers', color: 'black', x: 705, y: 312, adj: ['Madrid', 'Paris', 'Istanbul', 'Cairo'] },
    { name: 'Istanbul', color: 'black', x: 800, y: 252, adj: ['Milan', 'St. Petersburg', 'Algiers', 'Cairo', 'Baghdad', 'Moscow'] },
    { name: 'Cairo', color: 'black', x: 778, y: 332, adj: ['Algiers', 'Istanbul', 'Baghdad', 'Khartoum', 'Riyadh'] },
    { name: 'Moscow', color: 'black', x: 870, y: 192, adj: ['St. Petersburg', 'Istanbul', 'Tehran'] },
    { name: 'Baghdad', color: 'black', x: 855, y: 300, adj: ['Istanbul', 'Cairo', 'Riyadh', 'Tehran', 'Karachi'] },
    { name: 'Riyadh', color: 'black', x: 855, y: 378, adj: ['Cairo', 'Baghdad', 'Karachi'] },
    { name: 'Tehran', color: 'black', x: 920, y: 245, adj: ['Moscow', 'Baghdad', 'Karachi', 'Delhi'] },
    { name: 'Karachi', color: 'black', x: 930, y: 330, adj: ['Baghdad', 'Riyadh', 'Tehran', 'Delhi', 'Mumbai'] },
    { name: 'Mumbai', color: 'black', x: 945, y: 405, adj: ['Karachi', 'Delhi', 'Chennai'] },
    { name: 'Delhi', color: 'black', x: 1000, y: 295, adj: ['Tehran', 'Karachi', 'Mumbai', 'Chennai', 'Kolkata'] },
    { name: 'Chennai', color: 'black', x: 1010, y: 440, adj: ['Mumbai', 'Delhi', 'Kolkata', 'Bangkok', 'Jakarta'] },
    { name: 'Kolkata', color: 'black', x: 1055, y: 330, adj: ['Delhi', 'Chennai', 'Bangkok', 'Hong Kong'] },
    // ---- Red ----
    { name: 'Beijing', color: 'red', x: 1135, y: 235, adj: ['Shanghai', 'Seoul'] },
    { name: 'Seoul', color: 'red', x: 1220, y: 230, adj: ['Beijing', 'Shanghai', 'Tokyo'] },
    { name: 'Tokyo', color: 'red', x: 1290, y: 262, adj: ['Seoul', 'Shanghai', 'San Francisco', 'Osaka'] },
    { name: 'Shanghai', color: 'red', x: 1145, y: 300, adj: ['Beijing', 'Seoul', 'Tokyo', 'Taipei', 'Hong Kong'] },
    { name: 'Osaka', color: 'red', x: 1275, y: 335, adj: ['Tokyo', 'Taipei'] },
    { name: 'Taipei', color: 'red', x: 1195, y: 358, adj: ['Osaka', 'Hong Kong', 'Shanghai', 'Manila'] },
    { name: 'Hong Kong', color: 'red', x: 1118, y: 375, adj: ['Bangkok', 'Kolkata', 'Ho Chi Minh City', 'Shanghai', 'Manila', 'Taipei'] },
    { name: 'Bangkok', color: 'red', x: 1065, y: 412, adj: ['Kolkata', 'Chennai', 'Jakarta', 'Ho Chi Minh City', 'Hong Kong'] },
    { name: 'Ho Chi Minh City', color: 'red', x: 1115, y: 462, adj: ['Jakarta', 'Bangkok', 'Hong Kong', 'Manila'] },
    { name: 'Manila', color: 'red', x: 1208, y: 448, adj: ['Taipei', 'San Francisco', 'Ho Chi Minh City', 'Hong Kong', 'Sydney'] },
    { name: 'Jakarta', color: 'red', x: 1080, y: 535, adj: ['Chennai', 'Bangkok', 'Ho Chi Minh City', 'Sydney'] },
    { name: 'Sydney', color: 'red', x: 1245, y: 618, adj: ['Jakarta', 'Manila', 'Los Angeles'] },
  ];

  // Edges that wrap around the map edge (Pacific crossings).
  const wrapEdges = [
    ['San Francisco', 'Tokyo'],
    ['San Francisco', 'Manila'],
    ['Los Angeles', 'Sydney'],
  ];

  const roles = [
    {
      name: 'Medic',
      color: '#f97316',
      desc: 'Treat Disease removes ALL cubes of one color in your city. Cured diseases: cubes in your city are removed automatically (and cannot be placed there).',
    },
    {
      name: 'Scientist',
      color: '#e2e8f0',
      desc: 'You need only 4 city cards of one color (instead of 5) to Discover a Cure.',
    },
    {
      name: 'Researcher',
      color: '#a16207',
      desc: 'When you Share Knowledge, you may give ANY city card from your hand (you do not need to be in that city).',
    },
    {
      name: 'Dispatcher',
      color: '#d946ef',
      desc: 'As an action: move any pawn to a city containing another pawn, or move another player\'s pawn as if it were yours (flights discard from YOUR hand).',
    },
    {
      name: 'Operations Expert',
      color: '#22c55e',
      desc: 'Build a research station without discarding a card. Once per turn, from a research station: discard any city card to move to any city.',
    },
    {
      name: 'Quarantine Specialist',
      color: '#14b8a6',
      desc: 'No disease cubes can be placed in your city or in any city connected to it.',
    },
    {
      name: 'Contingency Planner',
      color: '#38bdf8',
      desc: 'As an action: take a discarded Event card and store it on this card (max 1). When you play it, remove it from the game.',
    },
  ];

  const events = [
    { name: 'Airlift', desc: 'Move any pawn to any city.' },
    { name: 'Government Grant', desc: 'Add a research station to any city (no card discard needed).' },
    { name: 'One Quiet Night', desc: 'Skip the next Infect Cities step (no infection cards are flipped).' },
    { name: 'Forecast', desc: 'Look at the top 6 cards of the Infection Deck, rearrange them in any order, and put them back on top.' },
    { name: 'Resilient Population', desc: 'Remove one card in the Infection Discard Pile from the game. May be played between the Infect and Intensify steps of an epidemic.' },
  ];

  // One fun fact + one must-see spot per city, shown on drawn-card postcards.
  const cityFacts = {
    'San Francisco': { fact: 'The famous fog is so beloved locals named it "Karl".', see: 'Golden Gate Bridge' },
    'Chicago': { fact: 'Birthplace of the skyscraper (1885).', see: 'The Bean in Millennium Park' },
    'Atlanta': { fact: 'Home to the world\'s busiest airport.', see: 'Georgia Aquarium' },
    'Montreal': { fact: 'Second-largest French-speaking city on Earth.', see: 'Old Montreal' },
    'New York': { fact: 'Over 800 languages are spoken here.', see: 'Central Park' },
    'Washington': { fact: 'The street plan was drawn by Pierre L\'Enfant in 1791.', see: 'the National Mall' },
    'London': { fact: 'The Tube (1863) is the world\'s oldest metro.', see: 'Tower of London' },
    'Madrid': { fact: 'Europe\'s highest capital, at ~650 m.', see: 'the Prado Museum' },
    'Paris': { fact: 'The Eiffel Tower grows ~15 cm taller in summer heat.', see: 'the Louvre' },
    'Essen': { fact: 'Once the coal-and-steel heart of the Ruhr valley.', see: 'Zollverein coal mine (UNESCO)' },
    'Milan': { fact: 'The Duomo took nearly 600 years to complete.', see: 'Galleria Vittorio Emanuele II' },
    'St. Petersburg': { fact: 'City of 300+ bridges and midsummer White Nights.', see: 'the Hermitage' },
    'Los Angeles': { fact: 'The Hollywood sign originally read "Hollywoodland".', see: 'Griffith Observatory' },
    'Mexico City': { fact: 'Built on the Aztec island-city of Tenochtitlan — and slowly sinking.', see: 'Teotihuacan pyramids' },
    'Miami': { fact: 'The only major US city founded by a woman, Julia Tuttle.', see: 'South Beach Art Deco district' },
    'Bogota': { fact: 'Sits at a lofty 2,640 m in the Andes.', see: 'Monserrate hill' },
    'Lima': { fact: 'The second-driest capital on Earth, after Cairo.', see: 'the Miraflores clifftop boardwalk' },
    'Santiago': { fact: 'You can ski the Andes and hit the beach on the same day.', see: 'Cerro San Cristóbal' },
    'Buenos Aires': { fact: 'The birthplace of tango.', see: 'Caminito in La Boca' },
    'Sao Paulo': { fact: 'The largest city in the Southern Hemisphere.', see: 'Avenida Paulista & MASP' },
    'Lagos': { fact: 'Africa\'s biggest city and home of Nollywood.', see: 'Lekki beaches' },
    'Kinshasa': { fact: 'The world\'s largest French-speaking city.', see: 'the Congo River rapids' },
    'Johannesburg': { fact: 'Built atop one of the richest gold reefs ever found.', see: 'the Apartheid Museum' },
    'Khartoum': { fact: 'Where the Blue Nile and White Nile meet.', see: 'al-Mogran confluence point' },
    'Algiers': { fact: 'Its whitewashed Casbah is a UNESCO site.', see: 'Notre-Dame d\'Afrique' },
    'Istanbul': { fact: 'The only major city spanning two continents.', see: 'Hagia Sophia' },
    'Cairo': { fact: 'Neighbors the only surviving ancient wonder of the world.', see: 'the Giza pyramids' },
    'Moscow': { fact: 'Its metro stations are decorated like palaces.', see: 'Red Square & St Basil\'s' },
    'Baghdad': { fact: 'Home of the medieval House of Wisdom.', see: 'al-Mutanabbi book street' },
    'Riyadh': { fact: 'Grew from a mud-walled town to a skyscraper capital in ~70 years.', see: 'historic Diriyah' },
    'Tehran': { fact: 'Backed by 5,600 m Mount Damavand views.', see: 'Golestan Palace' },
    'Karachi': { fact: 'A megacity of 16+ million and Pakistan\'s first capital.', see: 'Clifton Beach' },
    'Mumbai': { fact: 'Bollywood releases 1,000+ films a year.', see: 'the Gateway of India' },
    'Delhi': { fact: 'Holds three UNESCO World Heritage sites.', see: 'the Red Fort' },
    'Chennai': { fact: 'Marina Beach is one of the longest urban beaches anywhere.', see: 'Kapaleeshwarar Temple' },
    'Kolkata': { fact: 'India\'s culture capital and home of poet Tagore.', see: 'Victoria Memorial & Howrah Bridge' },
    'Beijing': { fact: 'The Forbidden City has more than 8,700 rooms.', see: 'the Great Wall at Mutianyu' },
    'Seoul': { fact: 'Runs on some of the fastest internet on the planet.', see: 'Gyeongbokgung Palace' },
    'Tokyo': { fact: 'The largest metro area on Earth — about 37 million people.', see: 'Shibuya Crossing' },
    'Shanghai': { fact: 'Its maglev train hits 431 km/h.', see: 'the Bund waterfront' },
    'Osaka': { fact: 'Nicknamed "the nation\'s kitchen" for its street food.', see: 'Dotonbori & Osaka Castle' },
    'Taipei': { fact: 'Taipei 101 is steadied by a 660-ton golden damper ball.', see: 'Shilin Night Market' },
    'Hong Kong': { fact: 'Has more skyscrapers than any other city.', see: 'Victoria Peak' },
    'Bangkok': { fact: 'Its full ceremonial name is 168 letters long.', see: 'the Grand Palace' },
    'Ho Chi Minh City': { fact: 'Seven million motorbikes share its streets.', see: 'Ben Thanh Market & Cu Chi tunnels' },
    'Manila': { fact: 'Binondo (1594) is the world\'s oldest Chinatown.', see: 'Intramuros walled city' },
    'Jakarta': { fact: 'Sinking faster than any other megacity.', see: 'Kota Tua old town' },
    'Sydney': { fact: 'The Opera House roof wears over a million tiles.', see: 'Bondi Beach' },
  };

  // Darkly-comic storyline beats, grounded in each city's real character.
  // `reach` fires the first time a city is ever infected during play (its
  // spotlight moment); `crisis` fires when the city outbreaks or becomes the
  // epicenter of an epidemic. Each beat already names that city's strain
  // (blue=the Pale Cough, yellow=the Sweating Sickness, black=the Black Veil,
  // red=the Crimson Fever) since a city's color is fixed. Pure flavor; the
  // engine wraps every beat in try/catch (see game.js newsBeat).
  const cityLore = {
    // ---- Blue: the Pale Cough ----
    'San Francisco': {
      reach: 'SAN FRANCISCO — The first cases arrive by way of oat-milk flat whites. A man in a fleece vest insists the Pale Cough is less a disease than "a disruptive new platform for wellness."',
      crisis: 'SAN FRANCISCO — The Pale Cough engulfs the city just as Karl the Fog rolls in to swallow the Sutro Tower for breakfast. The sourdough starters are evacuated first; the humans are told to shelter in place and "optimize their journey."',
    },
    'Chicago': {
      reach: 'CHICAGO — The Pale Cough turns up downtown. Locals are mostly furious that New York\'s knockoff Bean might get infected first and steal the headline.',
      crisis: 'CHICAGO — The Pale Cough overruns the city. Officials debate the structural integrity of deep-dish quarantine bunkers; a New Yorker is detained for calling the pizza "a casserole."',
    },
    'Atlanta': {
      reach: 'ATLANTA — The Pale Cough reaches the home of the CDC, on land Coca-Cola once sold the government for ten dollars. Officials order a Coke — meaning, as ever in the South, any soda whatsoever.',
      crisis: 'ATLANTA — The Pale Cough closes the local Waffle House. Since FEMA gauges catastrophe by whether the Waffle House is open, the threat level is quietly upgraded to "biblical." Two inches of theoretical snow finish the job.',
    },
    'Montreal': {
      reach: 'MONTREAL — The Pale Cough surfaces between the orange traffic cones. The language watchdog\'s first move is to confirm "PANDÉMIE" on the warning signs is twice the size of "PANDEMIC."',
      crisis: 'MONTREAL — The Pale Cough overwhelms the city. Ponto, the beloved anthropomorphic construction cone, is named interim head of public health; the poutine-gravy supply is declared a strategic reserve.',
    },
    'New York': {
      reach: 'NEW YORK — The Pale Cough arrives. A garbled subway announcement that may have contained crucial public-health guidance is lost forever to "stand clear of the closing—bzzt."',
      crisis: 'NEW YORK — The Pale Cough sweeps the boroughs. Pizza Rat is named patient zero by popular vote, narrowly beating the bodega cats — who are each fined $300 for the privilege.',
    },
    'Washington': {
      reach: 'WASHINGTON — The Pale Cough reaches the capital, where 74 lobbyists per senator promptly register to represent it. A task force is formed to consider forming a task force.',
      crisis: 'WASHINGTON — The Pale Cough breaches the Beltway. The half-smoke supply at Ben\'s Chili Bowl becomes the subject of an emergency filibuster; nobody inside the bubble believes the public understands what is happening, which is correct.',
    },
    'London': {
      reach: 'LONDON — The Pale Cough arrives and a perfectly orderly queue forms to catch it. "Bit of a nuisance, really," says a man, not looking up from his tea.',
      crisis: 'LONDON — The Pale Cough overwhelms the city, met with stiff-upper-lip understatement and a fresh cuppa. There is now a queue simply to join the queue, and everyone apologizes to the virus for the wait.',
    },
    'Madrid': {
      reach: 'MADRID — The Pale Cough appears, but no one can be infected before 10pm, when Madrid deigns to eat dinner. El Oso y el Madroño, the city\'s bear statue, tests positive first.',
      crisis: 'MADRID — The Pale Cough engulfs the city. At Botín, the world\'s oldest restaurant, the wood-fired oven that has burned without pause since 1725 is finally threatened; the curfew is ignored on principle.',
    },
    'Paris': {
      reach: 'PARIS — The Pale Cough arrives. Tourists, already crushed by Paris Syndrome at the disappointment of the actual city, barely register a mere plague. A waiter gives the virus "space."',
      crisis: 'PARIS — The Pale Cough overruns the city, triggering an immediate grève. The boulangeries are stripped of baguettes; the pigeons, defiant, continue to deface every monument precisely on schedule.',
    },
    'Essen': {
      reach: 'ESSEN — The Pale Cough arrives in the Ruhr and is processed with Teutonic efficiency. The currywurst rationing schedule is published, to the minute, in triplicate.',
      crisis: 'ESSEN — The Pale Cough overwhelms Steel City. A Bauhaus quarantine center opens exactly on time at the world\'s most beautiful coal mine; the response is so well-organized it wins a design award.',
    },
    'Milan': {
      reach: 'MILAN — The Pale Cough arrives during aperitivo and is at first mistaken for a daring new accessory. Citizens flee, but only in immaculate designer outerwear.',
      crisis: 'MILAN — The Pale Cough sweeps the fashion capital. Saffron — worth more by weight than gold — vanishes into hoarders\' risotto, and the aperitivo buffets are stripped bare by the impeccably dressed.',
    },
    'St. Petersburg': {
      reach: 'ST. PETERSBURG — The Pale Cough drifts in on the White Nights, when the sun never sets and the city never sleeps long enough to notice. The Hermitage cats are briefed first.',
      crisis: 'ST. PETERSBURG — The Pale Cough overwhelms the city. The Hermitage\'s staff cats — each with a caretaker and a press secretary — vote to unionize and demand hazard pay, while the drawbridges rise and strand everyone on the wrong side of the Neva.',
    },
    // ---- Yellow: the Sweating Sickness ----
    'Los Angeles': {
      reach: 'LOS ANGELES — The Sweating Sickness arrives, but everyone\'s stuck on the 405 and won\'t reach a hospital until Thursday. Wellness influencers pivot to selling immunity by smoothie.',
      crisis: 'LOS ANGELES — The Sweating Sickness overruns the city. A $33 celebrity smoothie is rebranded as PPE, and the Hollywood sign is vandalized to read "HOLLYWHEEZE" — its most honest message in years.',
    },
    'Mexico City': {
      reach: 'MEXICO CITY — The Sweating Sickness arrives in a city simultaneously sinking and running out of water. The Ángel de la Independencia, now fourteen steps taller than it was built, looks down unimpressed.',
      crisis: 'MEXICO CITY — The Sweating Sickness engulfs the capital. Water trucks roll under armed guard as the ground sinks 40cm a year beneath the panic; only the eternally smiling axolotl seems unbothered.',
    },
    'Miami': {
      reach: 'MIAMI — The Sweating Sickness arrives, but the feral chickens that rule the city refuse to be quarantined. Residents redirect their hurricane-prep instincts toward the cafecito window.',
      crisis: 'MIAMI — The Sweating Sickness sweeps the city during a cold snap, so frozen iguanas rain stunned from the trees. Officials clarify the iguanas are not dead, merely "doing what we\'re all doing."',
    },
    'Bogota': {
      reach: 'BOGOTÁ — The Sweating Sickness must take the cable car up to Monserrate to infect the holy summit. Pico y Placa rules mean it may only spread on odd-numbered days.',
      crisis: 'BOGOTÁ — The Sweating Sickness overruns the city via the TransMilenio, where commuters were already packed like sardines into a rolling petri dish. The Colombia–Venezuela arepa war is paused, briefly, out of respect.',
    },
    'Lima': {
      reach: 'LIMA — The Sweating Sickness arrives under the garúa, the grey "donkey\'s-belly" fog smothering the world\'s second-driest capital. The virus cannot get a tan and is reportedly quite glum about it.',
      crisis: 'LIMA — The Sweating Sickness sweeps the city. A run on limes threatens the ceviche, and the Pisco War with Chile escalates as both nations claim the sole right to disinfect with the national spirit.',
    },
    'Santiago': {
      reach: 'SANTIAGO — The Sweating Sickness settles into the valley smog the government already declares a "pre-emergency" every winter. Chileans, veterans of disaster, shrug and order another Terremoto.',
      crisis: 'SANTIAGO — The Sweating Sickness overwhelms the city. The signature cocktail here is literally named the Earthquake: the second wave is downgraded to a "Réplica," the third upgraded to a "Cataclismo," and the avocado-and-mayo supply collapses entirely.',
    },
    'Buenos Aires': {
      reach: 'BUENOS AIRES — The Sweating Sickness arrives in the therapy capital of the world, where citizens call their analyst before their doctor. The mate gourd, passed mouth to mouth, is described by one epidemiologist as "a personal attack."',
      crisis: 'BUENOS AIRES — The Sweating Sickness overruns the city. Crowds gather at the Obelisco to protest it, as they would anything; with inflation what it is, panic-buying is just Tuesday and the exchange rate stays scarier than the plague.',
    },
    'Sao Paulo': {
      reach: 'SÃO PAULO — The Sweating Sickness arrives, and the wealthy simply take their 400-odd helicopters and fly over it, as they do the traffic and the kidnappers. The other 20 million sit in a 344-km jam.',
      crisis: 'SÃO PAULO — The Sweating Sickness sweeps the largest city in the Southern Hemisphere. It panic-orders pizza — 800,000 a day — instead of medical supplies, while the helipads of Avenida Paulista hum with the rich escaping by air.',
    },
    'Lagos': {
      reach: 'LAGOS — The Sweating Sickness arrives, but the real shortage is petrol — Nigeria pumps the crude and imports the fuel. "NEPA has taken the light," sighs the city, firing up a generator.',
      crisis: 'LAGOS — The Sweating Sickness overruns the megacity across its single 11.8-km Third Mainland Bridge. The owambe parties, where uninvited crowds are a measure of success, become superspreaders by design; the jollof, at least, is defended to the last grain.',
    },
    'Kinshasa': {
      reach: 'KINSHASA — The Sweating Sickness arrives, and the official public-health policy is Article 15: "débrouillez-vous" — fend for yourself. The Sapeurs refuse to ruin a designer silhouette with a hazmat anything.',
      crisis: 'KINSHASA — The Sweating Sickness engulfs the city. The only incorruptible quarantine enforcers are the solar-powered traffic robots, which famously take no bribes; the power, as ever, is out, so the nganda bar runs on candlelight.',
    },
    'Johannesburg': {
      reach: 'JOHANNESBURG — The Sweating Sickness reaches eGoli, the city of gold that still can\'t keep its lights on. Residents check the load-shedding app to see whether there\'s even power to read the news.',
      crisis: 'JOHANNESBURG — The Sweating Sickness "hijacks" the district — a word Joburg uses for cars and entire 55-storey buildings alike. The outbreak is logged as Stage 7 load-shedding, and pineapples vanish from shelves as everyone home-brews beer for the duration.',
    },
    'Khartoum': {
      reach: 'KHARTOUM — The Sweating Sickness arrives where the Blue and White Niles meet, then vanishes into a haboob — the towering wall of red sand the city gave the world its word for.',
      crisis: 'KHARTOUM — The Sweating Sickness sweeps the three-cities-in-one, which blame each other across the rivers. Sudan supplies 80% of the world\'s gum arabic, so as the acacia harvest stalls, Coca-Cola and M&M\'s quietly panic an ocean away.',
    },
    // ---- Black: the Black Veil ----
    'Algiers': {
      reach: 'ALGIERS — The Black Veil reaches Alger la Blanche, the dazzling white city, which is now turning a markedly less flattering color. Contact tracers immediately get lost in the Casbah.',
      crisis: 'ALGIERS — The Black Veil overruns the white city. Like the resistance before it, the disease goes underground in the labyrinth of the Casbah, where every alley loops back to where the tracers started an hour ago.',
    },
    'Istanbul': {
      reach: 'ISTANBUL — The Black Veil arrives and, unable to choose between continents, infects both Europe and Asia at once, technically. The legally mandated workplace tea breaks continue uninterrupted.',
      crisis: 'ISTANBUL — The Black Veil sweeps the only city on two continents, trapping commuters between them on the bridge. The çay shortage causes considerably more panic than the plague; vendors shout "ÇAY!" into the void.',
    },
    'Cairo': {
      reach: 'CAIRO — The Black Veil arrives beside the only surviving ancient wonder, having apparently endured since the pharaohs itself. Tourists are shocked the pyramids are basically in the suburbs; the gridlock makes the cordon moot anyway.',
      crisis: 'CAIRO — The Black Veil overwhelms the city. El-Fishawy coffeehouse, open continuously since 1773, declines to close for a mere plague, and citizens stockpile koshari — a dish that is already itself a chaotic pile-up of everything.',
    },
    'Moscow': {
      reach: 'MOSCOW — The Black Veil descends into the palatial chandeliered metro, the most glamorous infection vector ever devised. The city\'s train-riding stray dogs board as usual, ignoring quarantine and obeying only the traffic lights.',
      crisis: 'MOSCOW — The Black Veil sweeps the city through its marble cathedral-stations. Even the commuter dogs — who know their stops and disembark for the food stalls — are now unwitting superspreaders riding the rails in formal disregard of the rules.',
    },
    'Baghdad': {
      reach: 'BAGHDAD — The Black Veil arrives on the Tigris, as old, it claims, as Babylon. An extra health checkpoint is added to the daily dozen; no one notices the difference.',
      crisis: 'BAGHDAD — The Black Veil overwhelms the cradle of civilization. The masgouf grills along the river, smoking carp over date-palm wood since the 10th century, become the last gathering points as date stockpiles soar.',
    },
    'Riyadh': {
      reach: 'RIYADH — The Black Veil arrives, but at 50°C no one goes outside anyway — life is mall, to AC, to mall. Saudis were, in effect, already self-isolating; gahwa and dates are offered to the virus as a greeting.',
      crisis: 'RIYADH — The Black Veil sweeps the capital, which is extremely off-brand for Vision 2030. Camel milk vanishes from supermarket shelves, and the bottle-opener gap atop the Kingdom Centre Tower is, for once, not the strangest thing in town.',
    },
    'Tehran': {
      reach: 'TEHRAN — The Black Veil arrives in the nose-job capital of the world, where so many wear post-op face bandages as a status symbol that no one can tell who is quarantined and who simply visited a surgeon.',
      crisis: 'TEHRAN — The Black Veil overwhelms the city, choking on five million cars in a grid built for three hundred thousand. Officials revive the perennial plan to relocate the entire capital — this time, hopefully, somewhere the disease can\'t follow.',
    },
    'Karachi': {
      reach: 'KARACHI — The Black Veil reaches the "City of Lights," which now endures 14–18 hours of blackouts a day. You cannot run a contact-tracing app on a phone you cannot charge.',
      crisis: 'KARACHI — The Black Veil sweeps the megacity, where a thousand new vehicles join the roads daily and the traffic signals die with the power. Citizens defend the biryani to the last layer; the crime rate, perversely, improves.',
    },
    'Mumbai': {
      reach: 'MUMBAI — The Black Veil arrives, and Bollywood keeps filming through it — the outbreak gets a song-and-dance number by Tuesday. The dabbawalas deliver lunch on time, as they have through floods, riots, and famine.',
      crisis: 'MUMBAI — The Black Veil overwhelms the city via the crush-loaded local trains. The 5,000 dabbawalas remain the only institution still functioning; your home-cooked tiffin arrives precisely on schedule even as the city falls around it.',
    },
    'Delhi': {
      reach: 'DELHI — The Black Veil arrives, but with the air-quality index at 1,200, residents already wear masks for the Tuesday smog. Doctors cannot distinguish the symptoms from a normal day\'s breathing.',
      crisis: 'DELHI — The Black Veil sweeps the capital as neighboring states blame each other for both the stubble-burning haze and the outbreak. The city that invented butter chicken at Moti Mahal in 1947 now rations it by the spoon.',
    },
    'Chennai': {
      reach: 'CHENNAI — The Black Veil arrives, and the elaborate filter-kaapi ritual — pouring coffee from height between tumbler and saucer — is gently reclassified by epidemiologists as "an aerosol-generating procedure."',
      crisis: 'CHENNAI — The Black Veil overwhelms the city. Thirteen kilometres of Marina Beach prove impossible to patrol, and the auto-rickshaws, which never use the meter, now also negotiate your quarantine fare.',
    },
    'Kolkata': {
      reach: 'KOLKATA — The Black Veil arrives, and the city\'s intellectuals respond by debating the philosophy of the pandemic over tea rather than fleeing it. The yellow Ambassador taxis, like the disease, are charming relics that simply will not die.',
      crisis: 'KOLKATA — The Black Veil sweeps the city, sending hilsa-fish prices soaring past 2,500 rupees a kilo — Bengalis pay anyway. East Bengal fans cook ilish in mourning, Mohun Bagan fans cook prawns, and Durga Puja is, naturally, not cancelled.',
    },
    // ---- Red: the Crimson Fever ----
    'Beijing': {
      reach: 'BEIJING — The Crimson Fever arrives, spreading through "the Egg, the Nest, and the Underpants" — the arts center, the stadium, and the CCTV tower the city itself nicknamed. No one can distinguish it from the seasonal "Beijing cough."',
      crisis: 'BEIJING — The Crimson Fever overwhelms the capital as the air sensor ticks past "crazy bad" to "beyond index." Buying fever medicine flips your health code from green to red automatically, and the duck-pancake black market booms.',
    },
    'Seoul': {
      reach: 'SEOUL — The Crimson Fever arrives in a city governed by "ppalli-ppalli" — hurry, hurry — a population constitutionally incapable of slowing the spread. One in five already owns a dedicated kimchi fridge, so the hoarders are pre-equipped.',
      crisis: 'SEOUL — The Crimson Fever sweeps the city. Contact tracing publishes, minute by minute, whether a patient wore a mask and whether they used the toilet, while a man warns that running a desk fan in a closed room may finish what the disease started.',
    },
    'Tokyo': {
      reach: 'TOKYO — The Crimson Fever arrives at Shibuya Crossing, where 3,000 people defy social distancing every 90 seconds. A rail company formally apologizes for the outbreak departing 20 seconds early.',
      crisis: 'TOKYO — The Crimson Fever overwhelms the city. Shelves are stripped of toilet paper within the hour — for the sixth straight pandemic, despite it having nothing to do with the disease — and the government mails every household two cloth masks, several arriving with mold, insects, and a single human hair.',
    },
    'Shanghai': {
      reach: 'SHANGHAI — The Crimson Fever arrives, and a drone drifts over the towers broadcasting, "Control your soul\'s desire for freedom. Do not open the window or sing." The Bund falls eerily silent.',
      crisis: 'SHANGHAI — The Crimson Fever sweeps the financial capital that rivals New York, now reduced to bartering duck meat and hand cream in the elevator lobby. Robot dogs with loudspeakers patrol the empty streets dispensing wellness tips; the five-day plan enters its eighth week.',
    },
    'Osaka': {
      reach: 'OSAKA — The Crimson Fever arrives, and the giant mechanical Kani Doraku crab announces it has "lost its legs from exhaustion" — genuinely a real headline. The city\'s designated comedy straight-man stands ready to smack the outbreak briefing.',
      crisis: 'OSAKA — The Crimson Fever overwhelms the city, whose motto is kuidaore — "eat yourself bankrupt." Osakans do exactly that, stockpiling takoyaki and okonomiyaki instead of masks, while the Glico Running Man neon keeps triumphantly finishing a race no one else can.',
    },
    'Taipei': {
      reach: 'TAIPEI — The Crimson Fever arrives, and the city\'s official response mascot is, regrettably, Damper Baby — the kawaii cartoon of the 660-ton ball that keeps Taipei 101 from swaying. It is not reassuring.',
      crisis: 'TAIPEI — The Crimson Fever sweeps the city, the tapioca pearls of its invented bubble tea now an unwelcome metaphor for spreading dots. Rival shops, having sued each other for a decade over who invented boba, briefly unite against a common enemy.',
    },
    'Hong Kong': {
      reach: 'HONG KONG — The Crimson Fever arrives in the densest skyline on Earth, where more people live above the 15th floor than anywhere. The Octopus card everyone taps for everything is, one epidemiologist notes, "a fomite with excellent brand recognition."',
      crisis: 'HONG KONG — The Crimson Fever overwhelms the city. Feng-shui experts blame the knife-edge of the Bank of China Tower for firing "killing energy" at the outbreak, while the dim sum carts, egg tarts, and milk tea make their last rounds.',
    },
    'Bangkok': {
      reach: 'BANGKOK — The Crimson Fever arrives, but it\'s stuck in the tuk-tuk gridlock, and the giant monitor lizards of Lumpini Park are unbothered. One is filmed climbing the shelves of a 7-Eleven, knocking off the milk.',
      crisis: 'BANGKOK — The Crimson Fever sweeps the city, where Wat Pho\'s 46-metre Reclining Buddha sets the civic mood: lying down, eyes closed, done with it. Even the spirit houses appear to be sheltering in place.',
    },
    'Ho Chi Minh City': {
      reach: 'HO CHI MINH CITY — The Crimson Fever arrives amid nine million scooters, where the rule for survival is to walk slowly and never run. The virus, demanding everyone stand still, is fighting the entire premise of the city.',
      crisis: 'HO CHI MINH CITY — The Crimson Fever overwhelms Saigon. When the milk runs short the city simply reinvents egg coffee, as it did in the shortage of 1946; the metro, twelve years late, opens just in time to be shut.',
    },
    'Manila': {
      reach: 'MANILA — The Crimson Fever arrives, but with the world\'s worst traffic — 188 hours lost a year — it will reach the hospital eventually. The jeepneys, gloriously chromed, refuse on principle to be modernized or quarantined.',
      crisis: 'MANILA — The Crimson Fever sweeps the city. A Chickenjoy shortage at Jollibee, whose fans queue twelve hours for a meal, outranks the plague in the public mind; the lockdown silences the videoke bars, and the absence of off-key "My Way" unnerves everyone more than the disease.',
    },
    'Jakarta': {
      reach: 'JAKARTA — The Crimson Fever arrives in the world\'s most congested city, where the gridlock — macet — is the first word visitors learn. Only the ojek motorcycle taxis can outrun it.',
      crisis: 'JAKARTA — The Crimson Fever overwhelms the fastest-sinking megacity on Earth, which is simultaneously being abandoned as the government moves the capital 800 miles away. Citizens face the plague the way they face everything: with a 19-billion-pack-a-year supply of Indomie noodles.',
    },
    'Sydney': {
      reach: 'SYDNEY — The Crimson Fever arrives, and within minutes 39 million rolls of toilet paper vanish from the shelves — Australia being the literal birthplace of the loo-roll wars. Two adults are charged with assault over a 24-pack.',
      crisis: 'SYDNEY — The Crimson Fever sweeps the city. The Prime Minister goes on television to ask everyone to "just stop it." Official health advice — smear Vegemite behind your ears, mind the swooping magpies — proves indistinguishable from the standard drop-bear precautions.',
    },
  };

  globalThis.PANDEMIC_DATA = { cities, wrapEdges, roles, events, cityFacts, cityLore };
})();

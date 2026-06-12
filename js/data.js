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

  globalThis.PANDEMIC_DATA = { cities, wrapEdges, roles, events, cityFacts };
})();

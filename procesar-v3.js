const fs = require('fs');

// Data "Real" con IDs proporcionada por el usuario
const rawData = `44	ASODE	2009-2010	Categoría 2009-2010 - ASODE	2009-2010	2009	Activo	edit delete
45	ASODE	2011-2012	Categoría 2011-2012 - ASODE	2011-2012	2011	Activo	edit delete
46	ASODE	2012-2013	Categoría 2012-2013 - ASODE	2012-2013	2012	Activo	edit delete
47	ASODE	2014	Categoría 2014 - ASODE	2014-2014	2014	Activo	edit delete
48	ASODE	2015-2016	Categoría 2015-2016 - ASODE	2015-2016	2015	Activo	edit delete
49	ASODE	2017	Categoría 2017 - ASODE	2017-2017	2017	Activo	edit delete
34	Básquet	2009-2008	Categoría 2009-2008 - Básquet	2008-2009	2008	Activo	edit delete
35	Básquet	2009	Categoría 2009 - Básquet	2009-2009	2009	Activo	edit delete
37	Básquet	2010	Categoría 2010 - Básquet	2010-2010	2010	Activo	edit delete
36	Básquet	2010-2011	Categoría 2010-2011 - Básquet	2010-2011	2010	Activo	edit delete
38	Básquet	2011	Categoría 2011 - Básquet	2011-2011	2011	Activo	edit delete
39	Básquet	2012-2013	Categoría 2012-2013 - Básquet	2012-2013	2012	Activo	edit delete
40	Básquet	2014	Categoría 2014 - Básquet	2014-2014	2014	Activo	edit delete
41	Básquet	2015-2016	Categoría 2015-2016 - Básquet	2015-2016	2015	Activo	edit delete
42	Básquet	2017	Categoría 2017 - Básquet	2017-2017	2017	Activo	edit delete
50	Entrenamiento Funcional Mixto	adulto +18	Categoría adulto +18 - Entrenamiento Funcional Mixto	1900-2008	1900	Activo	edit delete
2	Fútbol	2008-2009	Categoría 2008-2009 - Fútbol	2008-2009	2008	Activo	edit delete
1	Fútbol	2008-2009-2010-2011	Categoría 2008-2009-2010-2011 - Fútbol	2008-2011	2008	Activo	edit delete
3	Fútbol	2009-2010	Categoría 2009-2010 - Fútbol	2009-2010	2009	Activo	edit delete
4	Fútbol	2009-2010-2011-2012	Categoría 2009-2010-2011-2012 - Fútbol	2009-2012	2009	Activo	edit delete
5	Fútbol	2010-2011	Categoría 2010-2011 - Fútbol	2010-2011	2010	Activo	edit delete
6	Fútbol	2011-2012	Categoría 2011-2012 - Fútbol	2011-2012	2011	Activo	edit delete
7	Fútbol	2012-2013	Categoría 2012-2013 - Fútbol	2012-2013	2012	Activo	edit delete
8	Fútbol	2014-2013-2012	Categoría 2014-2013-2012 - Fútbol	2012-2014	2012	Activo	edit delete
9	Fútbol	2013-2014-2015	Categoría 2013-2014-2015 - Fútbol	2013-2015	2013	Activo	edit delete
10	Fútbol	2014-2013	Categoría 2014-2013 - Fútbol	2013-2014	2013	Activo	edit delete
11	Fútbol	2014	Categoría 2014 - Fútbol	2014-2014	2014	Activo	edit delete
12	Fútbol	2015	Categoría 2015 - Fútbol	2015-2015	2015	Activo	edit delete
13	Fútbol	2016-2015	Categoría 2016-2015 - Fútbol	2015-2016	2015	Activo	edit delete
15	Fútbol	2016	Categoría 2016 - Fútbol	2016-2016	2016	Activo	edit delete
14	Fútbol	2017-2016	Categoría 2017-2016 - Fútbol	2016-2017	2016	Activo	edit delete
17	Fútbol	2017	Categoría 2017 - Fútbol	2017-2017	2017	Activo	edit delete
16	Fútbol	2018-2017	Categoría 2018-2017 - Fútbol	2017-2018	2017	Activo	edit delete
18	Fútbol	2018-2019	Categoría 2018-2019 - Fútbol	2018-2019	2018	Activo	edit delete
19	Fútbol	2019	Categoría 2019 - Fútbol	2019-2019	2019	Activo	edit delete
20	Fútbol	2019-2020	Categoría 2019-2020 - Fútbol	2019-2020	2019	Activo	edit delete
21	Fútbol	2020-2021	Categoría 2020-2021 - Fútbol	2020-2021	2020	Activo	edit delete
22	Fútbol Femenino	2010-2015	Categoría 2010-2015 - Fútbol Femenino	2010-2015	2010	Activo	edit delete
51	GYM JUVENIL	2005-2009	Categoría 2005-2009 - GYM JUVENIL	2005-2009	2005	Activo	edit delete
43	MAMAS FIT	adulto +18	Categoría adulto +18 - MAMAS FIT	1900-2008	1900	Activo	edit delete
23	Vóley	2009-2008	Categoría 2009-2008 - Vóley	2008-2009	2008	Activo	edit delete
24	Vóley	2010-2009	Categoría 2010-2009 - Vóley	2009-2010	2009	Activo	edit delete
25	Vóley	2010	Categoría 2010 - Vóley	2010-2010	2010	Activo	edit delete
26	Vóley	2011-2010	Categoría 2011-2010 - Vóley	2010-2011	2010	Activo	edit delete
27	Vóley	2011	Categoría 2011 - Vóley	2011-2011	2011	Activo	edit delete
28	Vóley	2012-2011	Categoría 2012-2011 - Vóley	2011-2012	2011	Activo	edit delete
30	Vóley	2012-2013	Categoría 2012-2013 - Vóley	2012-2013	2012	Activo	edit delete
29	Vóley	2013-2012	Categoría 2013-2012 - Vóley	2012-2013	2012	Activo	edit delete
31	Vóley	2013-2014	Categoría 2013-2014 - Vóley	2013-2014	2013	Activo	edit delete
32	Vóley	2014	Categoría 2014 - Vóley	2014-2014	2014	Activo	edit delete
33	Vóley	2015-2016	Categoría 2015-2016 - Vóley	2015-2016	2015	Activo	edit delete`;

function parseData() {
    const lines = rawData.split('\n');
    let sql = `SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE categorias;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO categorias (id, deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) VALUES
`;

    // Mapeo de Deportes a IDs (Asumiendo que estos IDs del usuario NO son los de Deportes, sino de Categorias)
    // Pero necesito los IDs de Deportes... usare el mapeo standard que teniamos.
    const sportsMap = {
        'Fútbol': 1,
        'Fútbol Femenino': 2,
        'Vóley': 3,
        'Básquet': 4,
        'MAMAS FIT': 5,
        'ASODE': 6,
        'Entrenamiento Funcional Mixto': 7,
        'GYM JUVENIL': 8
    };

    const values = [];

    lines.forEach(line => {
        const cols = line.trim().split(/\t+/);
        if (cols.length < 5) return;

        // ID	Deporte	Nombre	Descripción	Rango Años	Orden	Estado	Acciones
        const id = cols[0].trim();
        const sportName = cols[1].trim();
        const nombre = cols[2].trim();
        const desc = cols[3].trim();
        const range = cols[4].trim();
        const orden = cols[5].trim();

        const deporteId = sportsMap[sportName];
        if (!deporteId) {
            console.log("Deporte no encontrado: " + sportName);
            return;
        }

        // Parse Range "2009-2010" -> 2009, 2010
        let min = 1900, max = 2099;
        const parts = range.split('-');
        if (parts.length === 2 && parts[0].length === 4 && parts[1].length === 4) {
            min = parts[0];
            max = parts[1];
        } else if (parts.length === 1 && parts[0].length === 4) {
            min = max = parts[0];
        } else if (range === '1900-2008') {
            min = 1900; max = 2008;
        }

        values.push(`(${id}, ${deporteId}, '${nombre}', '${desc}', ${min}, ${max}, ${orden}, 'activo')`);
    });

    sql += values.join(',\n') + ';';

    fs.writeFileSync('sincronizar-v3-ids.sql', sql);
    console.log('SQL generado con ' + values.length + ' filas.');
}

parseData();

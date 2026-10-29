import { assertNever } from "@coldtea/pr-lens-schema";
import type { ColumnKey, Lane } from "@coldtea/pr-lens-schema";
import { measure, truncate } from "../text.js";
import type { Palette } from "../theme.js";
import type { ScopedGraph } from "../scope.js";
import { canvasFor, union } from "../bounds.js";
import { coord, type Box } from "../geometry.js";
import { curveBounds } from "../layout/edges.js";
import { lines, tag, textNode, wrap } from "./primitives.js";
import { tableGlyph } from "./icons.js";
import { atlasBoxes, emptyAtlas, type RenderAtlas } from "../atlas.js";
import { markerFor, shifted, toneColour, toneFor } from "./document.js";
import { cardAttributes, cardGroupAttributes, relationAttributes, stylesFor } from "./styles.js";
import { cardOutlineClass, paintBadgeStrip, paintLabelPill } from "./architecture.js";
import { badgeStrip, badgesFor, cardTextWidth, laneHeaderText } from "../layout/architecture.js";
import {
  layoutDataModel,
  routeRelations,
  type PlacedTable,
  type RoutedRelation,
} from "../layout/datamodel.js";
import {
  CARD_HEIGHT_WITH_SUBTITLE,
  CARD_PADDING_X,
  CARD_RADIUS,
  DIAGRAM_MARGIN,
  ICON_CHIP_GAP,
  ICON_CHIP_RADIUS,
  ICON_CHIP_SIZE,
  KEY_CHIP_GAP,
  KEY_CHIP_HEIGHT,
  KEY_CHIP_WIDTH,
  LANE_HEADER_BASELINE,
  LANE_PADDING_X,
  LANE_RADIUS,
  LANE_TOP,
  SUBTITLE_SIZE,
  TABLE_ROW_HEIGHT,
  TABLE_ROW_TEXT_SIZE,
  TABLE_ROW_TYPE_SIZE,
} from "../design.js";

const keyChipText = (key: ColumnKey): string => {
  switch (key) {
    case "primary":
      return "PK";
    case "foreign":
      return "FK";
    case "index":
      return "IX";
    default:
      return assertNever(key, "Unhandled column key");
  }
};

/** The subtitle under a table's name: its physical name, and how many columns it has. */
const tableSubtitle = (placed: PlacedTable): string => {
  const count = `${placed.table.columns.length} ${placed.table.columns.length === 1 ? "column" : "columns"}`;
  return placed.table.name === undefined ? count : `${placed.table.name} · ${count}`;
};

const paintColumns = (placed: PlacedTable, palette: Palette): string => {
  const styles = stylesFor(palette);
  const { box } = placed;
  const left = box.x + CARD_PADDING_X;
  const nameX = left + KEY_CHIP_WIDTH + KEY_CHIP_GAP;
  const right = box.x + box.width - CARD_PADDING_X;

  return lines(
    placed.columns.map(({ column, centre }) => {
      const tone = toneFor(column.delta);
      const ink = (() => {
        switch (column.delta) {
          case "added":
            return palette.addedText;
          case "removed":
            return palette.removedText;
          case "modified":
          case "unchanged":
            return palette.foreground;
          default:
            return assertNever(column.delta, "Unhandled delta");
        }
      })();

      const chip =
        column.key === undefined
          ? ""
          : tag("rect", {
              class: "chip",
              x: coord(left),
              y: coord(centre - KEY_CHIP_HEIGHT / 2),
              width: KEY_CHIP_WIDTH,
              height: KEY_CHIP_HEIGHT,
              rx: KEY_CHIP_HEIGHT / 2,
              ...styles.chip,
            }) +
            textNode(
              {
                class: "keytext",
                x: coord(left + KEY_CHIP_WIDTH / 2),
                y: coord(centre + 3),
                "text-anchor": "middle",
                "font-size": 8,
                "font-weight": 700,
                "letter-spacing": ".06em",
                fill: palette.muted,
              },
              keyChipText(column.key),
            );

      // A changed type says what it was: the old spelling struck, then the new one.
      // Non-breaking spaces, because a tspan swallows the ordinary kind at its edges.
      const typeText = column.previousType === undefined ? column.type : `${column.previousType}\u00a0→\u00a0${column.type}`;
      const typeWidth = measure(typeText, "mono", TABLE_ROW_TYPE_SIZE);
      const typeFill = tone === "modified" ? palette.modifiedText : tone === "added" ? palette.addedText : palette.muted;
      const type =
        column.previousType === undefined
          ? textNode(
              { class: "coltype", x: coord(right), y: coord(centre + 3.5), "text-anchor": "end", "font-size": TABLE_ROW_TYPE_SIZE, "font-family": styles.subtitle["font-family"], fill: typeFill },
              typeText,
            )
          : wrap(
              "text",
              { class: "coltype", x: coord(right), y: coord(centre + 3.5), "text-anchor": "end", "font-size": TABLE_ROW_TYPE_SIZE, "font-family": styles.subtitle["font-family"], fill: typeFill },
              wrap("tspan", { fill: palette.muted, "text-decoration": "line-through" }, column.previousType) +
                wrap("tspan", {}, `\u00a0→\u00a0${column.type}`),
            );

      const nameRoom = right - typeWidth - KEY_CHIP_GAP - nameX;
      const name = textNode(
        {
          class: column.delta === "removed" ? "colname strike" : "colname",
          x: coord(nameX),
          y: coord(centre + 4),
          "font-size": TABLE_ROW_TEXT_SIZE,
          "font-family": styles.subtitle["font-family"],
          fill: ink,
          "text-decoration": column.delta === "removed" ? "line-through" : undefined,
        },
        truncate(column.name, "mono", TABLE_ROW_TEXT_SIZE, nameRoom),
      );

      return lines([chip, name, type]);
    }),
  );
};

/** The closing row of a folded card: a dashed rule, then how many columns stayed out of the picture. */
const paintFold = (placed: PlacedTable, palette: Palette): string => {
  const { fold, box } = placed;
  if (fold === undefined) return "";
  const styles = stylesFor(palette);
  const label = `+ ${fold.hidden} ${fold.unchangedOnly ? "unchanged columns" : "more columns"}`;
  return lines([
    tag("path", {
      class: "rule",
      d: `M${coord(box.x + CARD_PADDING_X)},${coord(fold.top)} h${coord(box.width - CARD_PADDING_X * 2)}`,
      stroke: palette.cardBorder,
      "stroke-width": 1,
      "stroke-dasharray": "3 3",
    }),
    textNode(
      {
        class: "fold",
        x: coord(box.x + CARD_PADDING_X + KEY_CHIP_WIDTH + KEY_CHIP_GAP),
        y: coord(fold.centre + 4),
        "font-size": TABLE_ROW_TEXT_SIZE,
        "font-family": styles.subtitle["font-family"],
        fill: palette.muted,
      },
      label,
    ),
  ]);
};

const paintTable = (placed: PlacedTable, palette: Palette): string => {
  const styles = stylesFor(palette);
  const { table, box, titleSize } = placed;
  const textX = box.x + CARD_PADDING_X + ICON_CHIP_SIZE + ICON_CHIP_GAP;
  const textWidth = cardTextWidth(box.width, true);
  const headerBottom = box.y + CARD_HEIGHT_WITH_SUBTITLE;

  const groupClass =
    table.delta === "removed" ? "cardsh ghost" : table.delta === "unchanged" ? "cardsh context" : "cardsh";

  return wrap(
    "g",
    { class: groupClass, ...cardGroupAttributes(table.delta, palette) },
    lines([
      tag("rect", {
        class: cardOutlineClass(table.delta),
        x: coord(box.x),
        y: coord(box.y),
        width: coord(box.width),
        height: coord(box.height),
        rx: CARD_RADIUS,
        ...cardAttributes(table.delta, palette),
      }),
      tag("rect", {
        class: "chip",
        x: coord(box.x + CARD_PADDING_X),
        y: coord(box.y + (CARD_HEIGHT_WITH_SUBTITLE - ICON_CHIP_SIZE) / 2),
        width: ICON_CHIP_SIZE,
        height: ICON_CHIP_SIZE,
        rx: ICON_CHIP_RADIUS,
        ...styles.chip,
      }),
      tableGlyph(box.x + CARD_PADDING_X + ICON_CHIP_SIZE / 2, box.y + CARD_HEIGHT_WITH_SUBTITLE / 2, styles),
      textNode(
        {
          class: table.delta === "removed" ? "ntitle strike" : "ntitle",
          x: coord(textX),
          y: coord(box.y + 27),
          "font-size": titleSize,
          ...styles.title,
          "text-decoration": table.delta === "removed" ? "line-through" : undefined,
        },
        truncate(table.label, "sans-bold", titleSize, textWidth),
      ),
      textNode(
        { class: "nsub", x: coord(textX), y: coord(box.y + 45), ...styles.subtitle },
        truncate(tableSubtitle(placed), "mono", SUBTITLE_SIZE, textWidth),
      ),
      tag("path", {
        class: "rule",
        d: `M${coord(box.x)},${coord(headerBottom)} h${coord(box.width)}`,
        stroke: palette.cardBorder,
        "stroke-width": 1,
      }),
      paintColumns(placed, palette),
      paintFold(placed, palette),
      paintBadgeStrip(badgeStrip(box, badgesFor(table.badges, table.delta)), table.delta, palette),
    ]),
  );
};

const paintRelation = (routed: RoutedRelation, palette: Palette): { markup: string; pill: string } => {
  const { relation, path, curve } = routed;
  const tone = toneFor(relation.delta);
  const classes = ["edge", `edge-${tone}`];
  if (relation.delta === "unchanged") classes.push("context");

  return {
    markup: lines([
      tag("path", {
        class: classes.join(" "),
        d: path,
        "marker-end": routed.head ? markerFor(tone) : undefined,
        ...relationAttributes(relation, palette),
      }),
      tag("circle", {
        class: "port",
        cx: coord(curve.from.x),
        cy: coord(curve.from.y),
        r: 2.5,
        fill: toneColour(palette, tone),
        opacity: relation.delta === "removed" ? 0.7 : undefined,
      }),
    ]),
    pill:
      routed.pill === undefined || relation.label === undefined
        ? ""
        : paintLabelPill(relation.label, routed.pill, tone, palette),
  };
};

export type DataModelPainting = {
  width: number;
  height: number;
  body: string;
  atlas: RenderAtlas;
};

export const paintDataModel = (graph: ScopedGraph, palette: Palette): DataModelPainting => {
  const layout = layoutDataModel(graph);
  const routed = routeRelations(layout, graph.relations);
  const styles = stylesFor(palette);

  const drawn: Box[] = layout.tables.flatMap(({ table, box }) => {
    const strip = badgeStrip(box, badgesFor(table.badges, table.delta));
    return strip === undefined ? [box] : [box, strip.box];
  });

  const edgeMarkup: string[] = [];
  const pillMarkup: string[] = [];
  for (const relation of routed) {
    const { markup, pill } = paintRelation(relation, palette);
    edgeMarkup.push(markup);
    pillMarkup.push(pill);
    if (relation.pill !== undefined) drawn.push(relation.pill);
  }

  const headerBaseline = layout.laneTop + (LANE_HEADER_BASELINE - LANE_TOP);
  const lanes = layout.stores.map(({ store, box }) => {
    const header: Lane = { id: store.id, label: store.label, subtitle: store.platform };
    return lines([
      tag("rect", {
        class: "lanebox",
        x: coord(box.x),
        y: coord(box.y),
        width: coord(box.width),
        height: coord(box.height),
        rx: LANE_RADIUS,
        ...styles.lane,
      }),
      textNode(
        { class: "lanelabel", x: coord(box.x + LANE_PADDING_X), y: coord(headerBaseline), ...styles.laneLabel },
        laneHeaderText(header),
      ),
    ]);
  });

  const canvas = canvasFor(
    layout,
    union([
      ...layout.stores.map(({ box }) => box),
      ...drawn,
      ...routed.map(({ curve }) => curveBounds(curve)),
    ]),
    DIAGRAM_MARGIN,
  );

  const painted = lines([
    wrap("g", {}, lines(lanes)),
    wrap("g", {}, lines(edgeMarkup)),
    wrap("g", {}, lines(layout.tables.map((table) => paintTable(table, palette)))),
    wrap("g", {}, lines(pillMarkup)),
  ]);

  return {
    width: canvas.width,
    height: canvas.height,
    body: shifted(canvas, painted),
    atlas: {
      ...emptyAtlas(),
      lanes: atlasBoxes(layout.stores.map(({ store, box }) => ({ id: store.id, box })), canvas),
      tables: atlasBoxes(layout.tables.map(({ table, box }) => ({ id: table.id, box })), canvas),
      columns: Object.fromEntries(
        layout.tables.map(({ table, box, columns }) => [
          table.id,
          atlasBoxes(
            columns.map(({ column, top }) => ({
              id: column.name,
              box: { x: box.x, y: top, width: box.width, height: TABLE_ROW_HEIGHT },
            })),
            canvas,
          ),
        ]),
      ),
      edges: atlasBoxes(
        routed.map(({ relation, curve }) => ({ id: relation.id, box: curveBounds(curve) })),
        canvas,
      ),
    },
  };
};

import IndicesComponent from "../components/IndicesComponent";
import ScrollableContainer from "../components/ScrollableContainer";
import SectionHeader from "@/app/dashboard/components/SectionHeader";

export default function IndicesSection(props: any) {
  const data = props;
  const map = data.data?.data?.exchangeAggRespMap;
  if (!map?.NSE?.indexLivePointsMap && !map?.BSE?.indexLivePointsMap)
    return null;
  const nse = map?.NSE?.indexLivePointsMap ?? {};
  const bse = map?.BSE?.indexLivePointsMap ?? {};
  const indicesList = {
    SENSEX: { name: "SENSEX", data: bse["1"] },
    NIFTY: { name: "NIFTY", data: nse.NIFTY },
    BANKNIFTY: { name: "BANKNIFTY", data: nse.BANKNIFTY },
    NIFTYMIDSELECT: { name: "NIFTYMIDSELECT", data: nse.NIFTYMIDSELECT },
    FINNIFTY: { name: "FINNIFTY", data: nse.FINNIFTY },
  };

  return (
    <div className="w-full">
      <SectionHeader eyebrow="Indices" count={5} />
      <ScrollableContainer>
        <IndicesComponent data={indicesList.SENSEX} />
        <IndicesComponent data={indicesList.NIFTY} />
        <IndicesComponent data={indicesList.BANKNIFTY} />
        <IndicesComponent data={indicesList.NIFTYMIDSELECT} />
        <IndicesComponent data={indicesList.FINNIFTY} />
      </ScrollableContainer>
    </div>
  );
}

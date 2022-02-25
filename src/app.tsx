import React from "react";
import PropTypes from "prop-types";
import "reflect-metadata";

import Plot from "react-plotly.js";
import { MobXProviderContext, observer } from "mobx-react";
import { observable, computed, action } from "mobx";
import * as mobx from "mobx";
import { plainToInstance } from "class-transformer";
import * as tidy from "@tidyjs/tidy";

import { Response, NarrativeEvent, EventKindUtil } from "./schemas/events";
import LoadingOverlay from "react-loading-overlay";

mobx.configure({
    enforceActions: "always",
    computedRequiresReaction: true,
    reactionRequiresObservable: true,
    observableRequiresReaction: true,
    disableErrorBoundaries: true
})


export class RootStore {
    @observable uiStore = new UiStore();
    @observable annotationStore = new AnnotationStore();

    constructor() {
        mobx.makeObservable(this)
    }
}

class UiStore {
    @observable currentText: string = "";
    @observable activeNarrativeEventId: string | undefined = undefined;
    @observable hoveredNarrativeEventId: string | undefined = undefined;
    shouldScrollToEvent: boolean = false;
    @observable loading = false;

    constructor() {
        mobx.makeObservable(this)
    }
}

class SmoothingConfig {
    @observable windowSize: number = 10

    constructor() {
        mobx.makeObservable(this)
    }
}

class AnnotationStore {
    @observable submitText: string = "";
    @observable annotations: NarrativeEvent[] = [];
    @observable smoothingConfig: SmoothingConfig = new SmoothingConfig();

    constructor() {
        mobx.makeObservable(this)
    }

    fetchEventAnnotations(text: string) {
        let promise = fetch("http://localhost:8080/predictions/ts_test", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({"text": text})
        }).then(resp => resp.json()).then(data => {
            let response = plainToInstance(Response, data as object, { excludeExtraneousValues: true });
            mobx.runInAction(() => {
                this.annotations = response.annotations;
                this.submitText = text;
            });
        });
        return promise;
    }

    @computed
    get smoothyValues(): number[] {
        let values = this.yValues.map((el): object => { return {value: el} });
        let out = tidy.tidy(
            this.annotations,
            tidy.map((el) => {return {value: el.predictedScore}}),
            tidy.mutateWithSummary({
                movingAvg: tidy.roll(this.smoothingConfig.windowSize, tidy.mean("value"), {partial: true}),
            }),
        );
        return out.map((el) => el["movingAvg"])
    }

    @computed
    get yValues(): number[] {
        return this.annotations.map((anno) => anno.predictedScore);
    }

    @computed
    get texts(): string[] {
        return this.annotations.map((anno) => this.submitText.slice(anno.start, anno.end))
    }

    @computed
    get xValues(): number[] {
        return Array.from(this.annotations.entries()).map(([index, anno]): number => index);
    }
}

interface AppProps {
    rootStore: RootStore,
};

@observer
export class App extends React.Component<AppProps, any> {
    render() {
        const {rootStore} = this.props
        return <LoadingOverlay
            active={rootStore.uiStore.loading}
            spinner
            text="Running Model"
        >
            <div className="column controlContainer">
                <TextForm rootStore={rootStore} />
                <EventGraph annotationStore={rootStore.annotationStore} uiStore={rootStore.uiStore} />
            </div>
            <div className="column textContainer">
                <TextView annotationStore={rootStore.annotationStore} uiStore={rootStore.uiStore} />
            </div>
        </LoadingOverlay>
    }
}

interface TextFormProps {
    rootStore: RootStore
}

@observer
class TextForm extends React.Component<TextFormProps, any> {
    handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        mobx.runInAction(() => {
            this.props.rootStore.uiStore.loading = true;
            this.props.rootStore.uiStore.currentText = event.currentTarget.inputText.value;
            this.props.rootStore.annotationStore.fetchEventAnnotations(this.props.rootStore.uiStore.currentText).then(() => {
                mobx.runInAction(() => {
                    this.props.rootStore.uiStore.loading = false;
                })
            });
        });
        event.preventDefault();
    }

    render() {
        return <div className="formContainer">
            <form onSubmit={this.handleSubmit} id="inputForm">
                <textarea name="inputText" defaultValue="Ich teste das narrativiäts Modell!"/>
                <button type="submit">Submit</button>
            </form>
        </div>
    }
}

let sliderSteps = (): Partial<Plotly.SliderStep>[] => {
    let out: Partial<Plotly.SliderStep>[] = [];
    for (let i = 10; i<=100; i += 10) {
        out.push({
            label: i.toString(),
            method: "update",
            args: [],
        })
    }
    return out
}

interface EventGraphProps {
    annotationStore: AnnotationStore;
    uiStore: UiStore;
}

@observer
class EventGraph extends React.Component<EventGraphProps, any> {
    handleWindowsizeChange = (event: React.FormEvent<HTMLInputElement>) => {
        mobx.runInAction(() => {
            this.props.annotationStore.smoothingConfig.windowSize = parseInt(event.currentTarget.value);
        });
        event.preventDefault();
    }

    sliderEnd = (event: Plotly.SliderEndEvent) => {
        mobx.runInAction(() => {
            this.props.annotationStore.smoothingConfig.windowSize = parseInt(event.step.label);
        });
    }

    sliderChange = (event: Plotly.SliderChangeEvent) => {
        mobx.runInAction(() => {
            this.props.annotationStore.smoothingConfig.windowSize = parseInt(event.step.label);
        });
    }

    onClick = (event: Plotly.PlotMouseEvent) => {
        mobx.runInAction(() => {
            this.props.uiStore.activeNarrativeEventId = this.props.annotationStore.annotations[event.points[0].pointNumber].getId()
            this.props.uiStore.shouldScrollToEvent = true;
        });
    }

    render() {
        return <Plot
            layout={{
                title: "Narrativity Plot",
                autosize: false,
                xaxis: {
                    range: [0, this.props.annotationStore.annotations.length],
                    title: {
                        text: "Event Index"
                    }
                },
                yaxis: {
                    range: [0, 5],
                    title: {
                        text: "Smoothed Narrativity Score"
                    }
                },
                width: 800,
                sliders: [{
                    pad: {t: 80},
                    currentvalue: {
                        xanchor: "left",
                        prefix: "Window Size: ",
                        font: {
                            color: '#888',
                            size: 12
                        }
                    },
                    steps: sliderSteps()
                }],
                transition: {
                    easing: "linear",
                    duration: 300
                }
            }}
            config={{
                displaylogo: false
            }}
            onClick={this.onClick}
            data={[{
                x: this.props.annotationStore.xValues,
                y: this.props.annotationStore.smoothyValues,
                text: this.props.annotationStore.texts,
                type: 'scatter'
            }]}
            onSliderChange={this.sliderChange}
        />
    }
}

interface TextViewProps {
    annotationStore: AnnotationStore;
    uiStore: UiStore;
}

@observer
class TextView extends React.Component<TextViewProps> {
    activeNarrativeEvent: React.RefObject<HTMLSpanElement> = React.createRef();

    scrollToActiveEvent = () => {
        if (this.activeNarrativeEvent.current) {
            this.activeNarrativeEvent.current.scrollIntoView({behavior: "smooth"});
        }
    }

    * getRelevantAnnotaitons(this: TextView, start: number, end: number) {
        for (let annotation of this.props.annotationStore.annotations) {
            if (annotation.start >= start && annotation.start <= end) {
                if (annotation.end > end) {
                    console.warn("Annotation across paragraphs");
                    yield annotation;
                } else {
                    yield annotation;
                }
            }
        }
    }


    buildSpanList(annotations: NarrativeEvent[]) {
        let spans: Array<[[number, number], NarrativeEvent]> = [];
        for (let anno of annotations) {
            for (let span of anno.spans) {
                spans.push([span, anno]);
            }
        }
        spans.sort((a: [[number, number], NarrativeEvent], b: [[number, number], NarrativeEvent]) => {
            if (a[0][0] > b[0][0]) {
                return 1;
            } else if (a[0][0] == b[0][0]) {
                return 0;
            } else {
                return -1; 
            }
        });
        let toDelete = [];
        // Sanity check, we don't want overlapping spans!
        for (let i = 0; i < (spans.length - 1); i++) {
            if (spans[i][0][1] > spans[i + 1][0][0]) {
                console.warn("Overlapping spans, discarding a span!")
                toDelete.push(i + 1);
            }
        }
        for (let i = 0; i < spans.length; i++) {
            if (Math.abs(spans[i][0][1] - spans[i][0][0]) <= 2) {
                toDelete.push(i);
            }
        }
        let unqiueDeletions = [...new Set(toDelete)];
        unqiueDeletions.sort((a, b): number => b - a);
        for (let entry of unqiueDeletions) {
           spans.splice(entry, 1);
        }
        return spans
    }

    buildAnnotationsComponents(text: string, annotations: NarrativeEvent[], startIndex: number) {
        let spans = this.buildSpanList(annotations);
        let inner: any[] = [];
        let indexInParagraph = 0;
        for (let span of spans) {
            inner.push(text.slice(indexInParagraph, span[0][0] - startIndex));
            let spanStart = span[0][0] - startIndex;
            let spanEnd = Math.min(
                span[0][1] - startIndex,
                startIndex + text.length
            );
            let props: React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> = {
                className: "verbPhrase",
                "id": span[1].getId(),
                onMouseEnter: () => {mobx.runInAction(() => {
                    this.props.uiStore.hoveredNarrativeEventId = span[1].getId();
                })},
                onMouseLeave: () => {mobx.runInAction(() => {
                    this.props.uiStore.hoveredNarrativeEventId = undefined;
                })},
                ref: null
            };
            if (span[1].getId() == this.props.uiStore.activeNarrativeEventId) {
                props.ref = this.activeNarrativeEvent;
                props.className += " activeScrolled"
            }
            if (span[1].getId() == this.props.uiStore.hoveredNarrativeEventId) {
                props.className += " activeHovered"
            }
            let eventKind = EventKindUtil.toString(span[1].predicted);
            let subscriptClass =  "eventKindAnno " + eventKind;
            inner.push(
                React.createElement(
                    "span",
                    props,
                    [text.slice(spanStart, spanEnd), <sub className={subscriptClass}>{eventKind}</sub>]
                )
            );
            indexInParagraph = spanEnd;
        }
        // Append the rest
        inner.push(text.slice(indexInParagraph, text.length))
        return inner;
    }

    render() {
        let paragraphs: React.DetailedReactHTMLElement<{}, HTMLElement>[] = [];
        let startIndex: number = 0;
        let n = 0;
        for (let paragraphText of this.props.annotationStore.submitText.split("\n\n")) {
            let annotationsIterator = this.getRelevantAnnotaitons(startIndex, startIndex + paragraphText.length)
            let annotations: NarrativeEvent[] = Array.from(annotationsIterator)
            let inner = this.buildAnnotationsComponents(paragraphText, annotations, startIndex);
            paragraphs.push(React.createElement("p", {key: "pargraph" + n.toString()}, inner));
            startIndex += paragraphText.length;
            startIndex += 2;
            n++;
        }
        return <div className="">
            {paragraphs}
        </div>
    }

    componentDidUpdate() {
        if (this.props.uiStore.shouldScrollToEvent) {
            this.scrollToActiveEvent()
            mobx.runInAction(() => {
                this.props.uiStore.shouldScrollToEvent = false;
            }
        } 
    }
}
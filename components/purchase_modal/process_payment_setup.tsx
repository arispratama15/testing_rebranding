// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {Stripe} from '@stripe/stripe-js';

import {FormattedMessage} from 'react-intl';

import {BillingDetails} from 'types/cloud/sku';
import {pageVisited} from 'actions/telemetry_actions';
import {TELEMETRY_CATEGORIES} from 'utils/constants';

import successSvg from 'images/cloud/payment_success.svg';
import failedSvg from 'images/cloud/payment_fail.svg';
import {t} from 'utils/i18n';
import {getNextBillingDate} from 'utils/utils';

import processSvg from 'images/cloud/processing_payment.svg';

import './process_payment.css';

import {Product} from 'mattermost-redux/types/cloud';

import IconMessage from './icon_message';

type Props = {
    billingDetails: BillingDetails | null;
    stripe: Promise<Stripe | null>;
    isDevMode: boolean;
    contactSupportLink: string;
    addPaymentMethod: (stripe: Stripe, billingDetails: BillingDetails, isDevMode: boolean) => Promise<boolean | null>;
    subscribeCloudSubscription: ((productId: string) => Promise<boolean | null>) | null;
    onBack: () => void;
    onClose: () => void;
    selectedProduct?: Product | null | undefined;
    currentProduct?: Product | null | undefined;
    isProratedPayment?: boolean;
}

type State = {
    progress: number;
    error: boolean;
    state: ProcessState;
}

enum ProcessState {
    PROCESSING = 0,
    SUCCESS,
    FAILED
}

const MIN_PROCESSING_MILLISECONDS = 5000;
const MAX_FAKE_PROGRESS = 95;

export default class ProcessPaymentSetup extends React.PureComponent<Props, State> {
    intervalId: NodeJS.Timeout;

    public constructor(props: Props) {
        super(props);

        this.intervalId = {} as NodeJS.Timeout;

        this.state = {
            progress: 0,
            error: false,
            state: ProcessState.PROCESSING,
        };
    }

    public componentDidMount() {
        this.savePaymentMethod();

        this.intervalId = setInterval(this.updateProgress, MIN_PROCESSING_MILLISECONDS / MAX_FAKE_PROGRESS);
    }

    public componentWillUnmount() {
        clearInterval(this.intervalId);
    }

    private updateProgress = () => {
        let {progress} = this.state;

        if (progress >= MAX_FAKE_PROGRESS) {
            clearInterval(this.intervalId);
            return;
        }

        progress += 1;
        this.setState({progress: progress > MAX_FAKE_PROGRESS ? MAX_FAKE_PROGRESS : progress});
    }

    private savePaymentMethod = async () => {
        const start = new Date();
        const {
            stripe,
            addPaymentMethod,
            billingDetails,
            isDevMode,
            subscribeCloudSubscription,
        } = this.props;
        const success = await addPaymentMethod((await stripe)!, billingDetails!, isDevMode);

        if (!success) {
            this.setState({
                error: true,
                state: ProcessState.FAILED});
            return;
        }

        if (subscribeCloudSubscription) {
            const productUpdated = await subscribeCloudSubscription(this.props.selectedProduct?.id as string);

            if (!productUpdated) {
                this.setState({
                    error: true,
                    state: ProcessState.FAILED});
                return;
            }
        }

        const end = new Date();
        const millisecondsElapsed = end.valueOf() - start.valueOf();
        if (millisecondsElapsed < MIN_PROCESSING_MILLISECONDS) {
            setTimeout(this.completePayment, MIN_PROCESSING_MILLISECONDS - millisecondsElapsed);
            return;
        }

        this.completePayment();
    }

    private completePayment = () => {
        clearInterval(this.intervalId);
        this.setState({state: ProcessState.SUCCESS, progress: 100});
    }

    private handleGoBack = () => {
        clearInterval(this.intervalId);
        this.setState({
            progress: 0,
            error: false,
            state: ProcessState.PROCESSING,
        });
        this.props.onBack();
    }

    private sucessPage = () => {
        const {error} = this.state;
        if (this.props.isProratedPayment) {
            const formattedButonText = (
                <FormattedMessage
                    defaultMessage={'Lets go!'}
                    id={'admin.billing.subscription.letsGo'}
                />
            );
            const formattedTitle = (
                <FormattedMessage
                    defaultMessage={'You are now subscribed to {selectedProductName}'}
                    id={'admin.billing.subscription.proratedPayment.title'}
                    values={{selectedProductName: this.props.selectedProduct?.name}}
                />
            );
            const formattedSubtitle = (
                <FormattedMessage
                    defaultMessage={'Thank you for upgrading to {selectedProductName}. You will be charged a prorated amount for your {currentProductName} plan and {selectedProductName} plan based on the number of days and number of users.'}
                    id={'admin.billing.subscription.proratedPayment.substitle'}
                    values={{selectedProductName: this.props.selectedProduct?.name, currentProductName: this.props.currentProduct?.name}}
                />
            );
            return (
                <>
                    <IconMessage
                        formattedTitle={formattedTitle}
                        formattedSubtitle={formattedSubtitle}
                        date={getNextBillingDate()}
                        error={error}
                        icon={successSvg}
                        formattedButonText={formattedButonText}
                        buttonHandler={this.props.onClose}
                        className={'success'}
                    />
                </>
            );
        }
        return (
            <IconMessage
                title={t('admin.billing.subscription.upgradedSuccess')}
                subtitle={t('admin.billing.subscription.nextBillingDate')}
                date={getNextBillingDate()}
                error={error}
                icon={successSvg}
                buttonText={t('admin.billing.subscription.letsGo')}
                buttonHandler={this.props.onClose}
                className={'success'}
            />
        );
    }

    public render() {
        const {state, progress, error} = this.state;

        const progressBar: JSX.Element | null = (
            <div className='ProcessPayment-progress'>
                <div
                    className='ProcessPayment-progress-fill'
                    style={{width: `${progress}%`}}
                />
            </div>
        );

        switch (state) {
        case ProcessState.PROCESSING:
            return (
                <IconMessage
                    title={t('admin.billing.subscription.verifyPaymentInformation')}
                    subtitle={''}
                    icon={processSvg}
                    footer={progressBar}
                />
            );
        case ProcessState.SUCCESS:
            pageVisited(
                TELEMETRY_CATEGORIES.CLOUD_PURCHASING,
                'pageview_payment_success',
            );
            return this.sucessPage();
        case ProcessState.FAILED:
            pageVisited(
                TELEMETRY_CATEGORIES.CLOUD_PURCHASING,
                'pageview_payment_failed',
            );
            return (
                <IconMessage
                    title={t('admin.billing.subscription.paymentVerificationFailed')}
                    subtitle={t('admin.billing.subscription.paymentFailed')}
                    icon={failedSvg}
                    error={error}
                    buttonText={t('admin.billing.subscription.goBackTryAgain')}
                    buttonHandler={this.handleGoBack}
                    linkText={t('admin.billing.subscription.privateCloudCard.contactSupport')}
                    linkURL={this.props.contactSupportLink}
                />
            );
        default:
            return null;
        }
    }
}
